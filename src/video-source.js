import { Parser } from 'htmlparser2';
import { MEDIA, DOWNLOAD_ORIGINS, safeUrl, fail, request } from './util.js';

export const videoOrigins = DOWNLOAD_ORIGINS;
export function videoUrl(value, base) {
  try { return safeUrl(new URL(value, base).href, videoOrigins).href; }
  catch { throw Object.assign(fail('지원하는 학교 영상 저장소 주소가 아닙니다. 원본 LMS에서 영상을 확인해 주세요.'),{code:'VIDEO_PROVIDER_UNSUPPORTED'}); }
}
export async function boundedText(response, limit = 2 * 1024 * 1024) {
  let bytes=0;const chunks=[];
  if (!response.body) throw fail('영상 정보 응답이 비어 있습니다.');
  for await (const chunk of response.body) { bytes+=chunk.length;if(bytes>limit)throw fail('영상 정보 응답이 너무 큽니다.');chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
function xmlTree(xml) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw fail('학교 영상 정보 형식을 확인할 수 없습니다.');
  const root={name:'root',children:[],text:'',attrs:{}},stack=[root];
  new Parser({onopentag(name,attrs){if(stack.length>40)throw fail('영상 정보 구조가 너무 깊습니다.');const node={name,attrs,text:'',children:[]};stack.at(-1).children.push(node);stack.push(node);},ontext(t){stack.at(-1).text+=t;},onclosetag(){if(stack.length>1)stack.pop();}}, {xmlMode:true,decodeEntities:true}).end(xml);
  return root;
}
const children=(node,name)=>node?.children.filter(x=>x.name===name)||[];
const child=(node,name)=>children(node,name)[0];
const descendants=(node,name)=>node ? node.children.flatMap(x=>[...(x.name===name?[x]:[]),...descendants(x,name)]) : [];
function candidate(value, auth, base) {
  let url;try{url=new URL(videoUrl(value,base));}catch{return null;}
  if(auth && !url.searchParams.has('token'))url.searchParams.set('token',auth);
  const format=/\.m3u8$/i.test(url.pathname)?'hls':/\.(mp4|m4v)$/i.test(url.pathname)?'mp4':null;
  return format?{url:url.href,format}:null;
}

// Parse Commons metadata, without loading a player or calling playback/progress endpoints.
export function parseVideoMetadata(xml, contentId) {
  const root=xmlTree(xml),content=child(root,'content'),playing=child(content,'content_playing_info');
  if(!playing)throw fail('학교 영상 재생 정보를 확인할 수 없습니다.');
  const declared=child(playing,'content_id')?.text.trim();
  if(declared && declared!==contentId)throw fail('요청한 영상과 학교 응답의 식별자가 다릅니다.');
  const service=child(content,'service_root');
  const templates=descendants(service,'media_uri').filter(x=>x.text.includes('[MEDIA_FILE]') && ['progressive','pseudo','hls'].includes(x.attrs.method));
  const direct=[];
  function collect(node,method='',auth) {
    if(!node)return;
    auth=node.attrs.auth_value||auth;
    const current=node.attrs.method||child(node,'method')?.text.trim()||method;
    if(node.name==='media_uri' && !node.text.includes('[MEDIA_FILE]') && !['rtmp','dash','drm'].includes(current)) {
      const value=candidate(node.text.trim(),auth,MEDIA);
      if(value)direct.push({...value,method:current||'progressive',target:node.attrs.target||'',rank:(value.format==='mp4'?0:10)+(current==='pseudo'?3:0)});
    }
    for(const nested of node.children)collect(nested,current,auth);
  }
  collect(child(playing,'main_media'));
  // Newer Commons manifests place the single media_uri directly under playing info.
  for(const node of children(playing,'media_uri'))collect(node);
  const stories=descendants(child(playing,'story_list'),'main_media').filter(x=>!x.children.length && x.text.trim());
  const main=child(playing,'main_media');
  if(!stories.length && main && !main.children.length && main.text.trim())stories.push(main);
  const parts=[];
  if(stories.length)for(const story of stories) {
    const filename=story.text.trim();
    if(/(^|[\\/])\.\.([\\/]|$)|[?#\\\x00-\x1f]/.test(filename))throw fail('영상 파일 경로를 확인할 수 없습니다.');
    const encoded=filename.split('/').map(encodeURIComponent).join('/');
    const options=[];
    for(const template of templates){const value=candidate(template.text.trim().replace('[MEDIA_FILE]',encoded),story.attrs.auth_value||template.attrs.auth_value,MEDIA);if(value)options.push({...value,method:template.attrs.method,target:template.attrs.target||'',rank:(value.format==='mp4'?0:10)+(template.attrs.method==='pseudo'?3:0)+(template.attrs.target==='mobile'?1:0)});}
    const matching=direct.filter(x=>decodeURIComponent(new URL(x.url).pathname.split('/').at(-1))===filename.split('/').at(-1));
    options.push(...matching);
    // The service web root also specifies the location of media_files for older UPF records.
    if(!options.length){const web=child(service,'web')?.text.trim();if(web){const base=videoUrl(web).replace(/\/?web_files\/?$/,'/media_files/');const value=candidate(encoded,story.attrs.auth_value,base.endsWith('/')?base:base+'/');if(value)options.push(value);}}
    if(!options.length)throw fail('이 강의의 일부 영상 원본을 확인할 수 없습니다. 원본 LMS에서 확인해 주세요.');
    parts.push(withCandidates(options));
  }
  else {
    // Multiple distinct direct entries can be desktop/mobile alternatives. Select one,
    // but never silently discard an ordered story sequence when one is provided.
    if(direct.length)parts.push(withCandidates(direct));
  }
  if(!parts.length)throw Object.assign(fail('지원하는 저장소의 다운로드 가능한 MP4 또는 HLS 원본이 없습니다. 원본 LMS에서 확인해 주세요.'),{code:'VIDEO_PROVIDER_UNSUPPORTED'});
  if(parts.length>100)throw fail('한 번에 저장할 수 있는 강의 파일 수를 초과했습니다.');
  return parts;
}

export async function learningVideo(client,item) {
  if(item.locked||!item.video)throw fail('현재 열람할 수 있는 강의 영상이 아닙니다.',403);
  const media=item.videoMetadata||{};
  const direct=[];
  for(const key of ['download_url','video_url','file_url','media_uri','mp4_url','hls_url','stream_url'])if(typeof media[key]==='string'){
    const value=candidate(media[key],undefined,MEDIA);if(value)direct.push(value);
  }
  if(direct.length)return {parts:attachPage([withCandidates(direct.map(x=>({...x,rank:x.format==='mp4'?0:10})))],item.viewer),version:null};
  const viewer=videoUrl(item.viewer);
  if(/\.(mp4|m4v|m3u8)(?:\?|$)/i.test(viewer))return {parts:attachPage([candidate(viewer)],item.viewer),version:null};
  const contentId=new URL(viewer).pathname.match(/^\/em\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  if(new URL(viewer).origin!==MEDIA||!contentId)throw Object.assign(fail('이 영상 제공자는 자동 다운로드를 지원하지 않습니다. 원본 LMS에서 확인해 주세요.'),{code:'VIDEO_PROVIDER_UNSUPPORTED'});
  const response=await request(client.fetcher,`${MEDIA}/viewer/ssplayer/uniplayer_support/content.php?content_id=${encodeURIComponent(contentId)}`);
  return {parts:parseVideoMetadata(await boundedText(response),contentId).map(part=>({...part,headers:{Referer:new URL(viewer).origin+new URL(viewer).pathname}})),version:null};
}

function withCandidates(options) {
  const unique=new Map();
  for(const value of [...options].sort((a,b)=>(a.rank||0)-(b.rank||0)))if(!unique.has(value.url))unique.set(value.url,{url:value.url,format:value.format,method:value.method||'progressive',target:value.target||''});
  const candidates=[...unique.values()].slice(0,10);
  return {url:candidates[0].url,format:candidates[0].format,candidates};
}

function attachPage(parts,viewer) {
  try {const page=safeUrl(viewer,[MEDIA]);if(!/^\/em\/[a-zA-Z0-9_-]+\/?$/.test(page.pathname))return parts;page.search='';return parts.map(part=>({...part,headers:{Referer:page.href}}));}catch{return parts;}
}
