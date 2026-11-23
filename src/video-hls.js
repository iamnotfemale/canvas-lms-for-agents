import { open, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash } from './cache.js';
import { fail } from './util.js';
import { safeName } from './paths.js';
import { videoUrl, boundedText } from './video-source.js';
import { transferVideoAsset, fileHash, validFile, ensureVideoDirectory, readJson } from './video-transfer.js';

function attributes(text) {
  const values={};
  for(const match of text.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g))values[match[1]]=match[2]??match[3];
  return values;
}
function byteRange(value, previous, uri) {
  if(!value)return null;
  const match=/^(\d+)(?:@(\d+))?$/.exec(value);
  if(!match)throw fail('지원하지 않는 HLS 구간 형식입니다.');
  const start=match[2]!==undefined?Number(match[2]):previous?.uri===uri?previous.end+1:NaN;
  const end=start+Number(match[1])-1;
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(end)||end<start)throw fail('HLS 구간 범위를 확인할 수 없습니다.');
  return {start,end};
}
export function parseHls(text,base) {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(x=>x.trim());
  if(lines[0]!=='#EXTM3U')throw fail('학교 응답이 HLS 영상 목록이 아닙니다.');
  const variants=[],audios=[],segments=[];let stream,duration,range,map,discontinuity=false,previousRange;
  for(const line of lines.slice(1)) {
    if(!line)continue;
    if(/^#EXT-X-(?:SESSION-)?KEY:/.test(line)) {if(attributes(line.slice(line.indexOf(':')+1)).METHOD!=='NONE')throw fail('암호화된 스트리밍은 자동 저장을 지원하지 않습니다. 원본 LMS에서 확인해 주세요.');}
    else if(/^#EXT-X-(DEFINE|GAP|PART|PRELOAD-HINT)(?::|$)/.test(line))throw fail('실시간 또는 일부가 누락된 스트리밍은 저장할 수 없습니다.');
    else if(line.startsWith('#EXT-X-STREAM-INF:'))stream=attributes(line.slice(18));
    else if(line.startsWith('#EXT-X-MEDIA:')) {const attrs=attributes(line.slice(13));if(attrs.TYPE==='AUDIO')audios.push(attrs);}
    else if(line.startsWith('#EXTINF:')) {duration=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(duration)||duration<=0)throw fail('HLS 재생 시간을 확인할 수 없습니다.');}
    else if(line.startsWith('#EXT-X-BYTERANGE:'))range=line.slice(17);
    else if(line.startsWith('#EXT-X-MAP:')) {const attrs=attributes(line.slice(11));if(!attrs.URI)throw fail('HLS 초기화 파일이 없습니다.');const url=videoUrl(attrs.URI,base);map={url,range:byteRange(attrs.BYTERANGE,null,url)};}
    else if(line==='#EXT-X-DISCONTINUITY')discontinuity=true;
    else if(!line.startsWith('#')) {
      const url=videoUrl(line,base);
      if(stream){variants.push({url,...stream});stream=undefined;}
      else {if(duration===undefined)throw fail('HLS 영상 구간 정보를 확인할 수 없습니다.');const selected=byteRange(range,previousRange,url);segments.push({url,duration,range:selected,map,discontinuity});previousRange=selected?{...selected,uri:url}:undefined;duration=range=undefined;discontinuity=false;}
    }
  }
  if(variants.length){if(segments.length||stream)throw fail('HLS 목록 구조가 올바르지 않습니다.');return {variants,audios};}
  if(!segments.length||!lines.includes('#EXT-X-ENDLIST')||duration!==undefined||segments.length>20000)throw fail('완료된 강의 영상 목록만 저장할 수 있습니다.');
  return {segments};
}
async function validateSegment(path) {
  const file=await open(path,'r');try{const data=Buffer.alloc(512),{bytesRead}=await file.read(data,0,512,0),size=(await file.stat()).size;
    if(size>=188&&size%188===0&&data[0]===0x47&&(bytesRead<189||data[188]===0x47))return '.ts';
    if(bytesRead>=8&&['ftyp','styp','moof','sidx'].includes(data.toString('ascii',4,8)))return data.toString('ascii',4,8)==='ftyp'?'.mp4':'.m4s';
    if(bytesRead>=4&&(data.toString('ascii',0,3)==='ID3'||data[0]===0xff&&(data[1]&0xf6)===0xf0))return '.aac';
    throw fail('스트리밍 응답이 영상 또는 음성 구간이 아닙니다.');
  }finally{await file.close();}
}
async function load(client,url,signal,requestHeaders) {
  const response=await client.openDownload({url,headers:requestHeaders},{},60000,signal);
  if(response.status!==200){await response.body?.cancel();throw fail('HLS 목록 응답을 확인할 수 없습니다.');}
  const base=videoUrl(response.url||url),text=await boundedText(response);
  return {base,parsed:parseHls(text,base),fingerprint:hash(text)};
}
async function selectedTrack(client,url,depth=0,signal,requestHeaders) {
  if(depth>3)throw fail('HLS 목록의 중첩 한도를 초과했습니다.');
  const loaded=await load(client,url,signal,requestHeaders);
  if(!loaded.parsed.variants)return {video:loaded,audio:null};
  const selected=loaded.parsed.variants.sort((a,b)=>Number(b.BANDWIDTH||0)-Number(a.BANDWIDTH||0))[0];
  const next=await selectedTrack(client,selected.url,depth+1,signal,requestHeaders);
  if(selected.AUDIO) {
    const group=loaded.parsed.audios.filter(x=>x['GROUP-ID']===selected.AUDIO);
    if(!group.length)throw fail('스트리밍의 음성 트랙을 확인할 수 없습니다.');
    const audio=group.find(x=>x.DEFAULT==='YES')||group[0];
    if(audio.URI){if(next.audio)throw fail('중첩된 별도 음성 트랙은 지원하지 않습니다.');const track=await selectedTrack(client,videoUrl(audio.URI,loaded.base),depth+1,signal,requestHeaders);if(track.audio)throw fail('음성 목록 구조를 확인할 수 없습니다.');next.audio=track.video;}
  }
  return next;
}
async function materialize(client,track,work,prefix,budget,records,priorFiles,requestHeaders) {
  const result=[],files=[];let lastMap;
  const get=async(source,key)=>{
    const previous=await readJson(join(work,key+'.json'))||priorFiles.get(key);
    const record=await transferVideoAsset(client,source.url,work,key,{previous,version:track.fingerprint,range:source.range,budget,revalidate:priorFiles.has(key),requestHeaders});
    const extension=await validateSegment(record.path);
    const filename=key+extension;files.push({...record,name:filename});records.push(record);return filename;
  };
  const maxDuration=Math.ceil(Math.max(...track.parsed.segments.map(x=>x.duration)));
  result.push('#EXTM3U','#EXT-X-VERSION:7',`#EXT-X-TARGETDURATION:${maxDuration}`,'#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-PLAYLIST-TYPE:VOD');
  for(const [index,segment]of track.parsed.segments.entries()) {
    if(segment.discontinuity)result.push('#EXT-X-DISCONTINUITY');
    const mapId=segment.map?hash(segment.map.url+JSON.stringify(segment.map.range)):null;
    if(mapId&&mapId!==lastMap) {
      const filename=await get(segment.map,prefix+'-map-'+index);
      result.push(`#EXT-X-MAP:URI="${filename}"`);lastMap=mapId;
    }
    const filename=await get(segment,prefix+'-'+String(index).padStart(5,'0'));
    result.push(`#EXTINF:${segment.duration},`,filename);
  }
  result.push('#EXT-X-ENDLIST');return {text:result.join('\n')+'\n',files};
}
export async function downloadHls(client,url,work,directory,title,budget,previous,requestHeaders={}) {
  const tracks=await selectedTrack(client,url,0,budget.signal,requestHeaders),fingerprint=hash(tracks.video.fingerprint+(tracks.audio?.fingerprint||''));
  if(previous?.fingerprint===fingerprint && previous.checkedAt>Date.now()-120000 && previous.files?.length && (await Promise.all(previous.files.map(validFile))).every(Boolean)) {
    const bytes=previous.files.reduce((n,x)=>n+x.bytes,0);budget.used+=bytes;if(budget.used>budget.max)throw fail('영상 다운로드 용량 한도를 초과했습니다.');
    if(previous.directory===directory)return {...previous,reused:true};
    return publishPackage(previous.files,directory,title,fingerprint,true);
  }
  const priorFiles=new Map((previous?.files||[]).map(file=>[file.name.replace(/\.[^.]+$/,''),file]));
  const records=[],video=await materialize(client,tracks.video,work,'video',budget,records,priorFiles,requestHeaders);
  const files=[...video.files];
  const playlist=async(name,text)=>{budget.used+=Buffer.byteLength(text);if(budget.used>budget.max)throw fail('영상 다운로드 용량 한도를 초과했습니다.');const path=join(work,name);await writeFile(path,text,{mode:0o600});files.push({name,path,bytes:Buffer.byteLength(text),sha:hash(text)});};
  if(tracks.audio){const audio=await materialize(client,tracks.audio,work,'audio',budget,records,priorFiles,requestHeaders);files.push(...audio.files);await playlist('video.m3u8',video.text);await playlist('audio.m3u8',audio.text);await playlist('index.m3u8','#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"\nvideo.m3u8\n');}
  else await playlist('index.m3u8',video.text);
  if(previous?.directory===directory && previous.files?.length===files.length && files.every(file=>previous.files.some(old=>old.name===file.name&&old.sha===file.sha)) && (await Promise.all(previous.files.map(validFile))).every(Boolean))return {...previous,fingerprint,checkedAt:Date.now(),reused:records.every(x=>x.reused)};
  return publishPackage(files,directory,title,fingerprint,records.every(x=>x.reused));
}
async function publishPackage(files,directory,title,fingerprint,reused) {
  const folder=await ensureVideoDirectory(directory),stem=safeName(title.replace(/\.(mp4|m3u8)$/i,''),'강의영상',100)+' (HLS)';
  for(let n=0;n<1000;n++) {
    const target=join(folder,stem+(n?` (${n})`:''));
    try{await mkdir(target,{mode:0o700});}catch(e){if(e.code==='EEXIST')continue;throw e;}
    try {
      const published=[];
      // Publish the entry playlist last, so an unfinished package cannot be opened accidentally.
      for(const file of [...files].sort((a,b)=>(a.name==='index.m3u8'?1:0)-(b.name==='index.m3u8'?1:0))) {
        if(!/^[a-z0-9-]+\.(ts|m4s|mp4|aac|m3u8)$/.test(file.name))throw fail('영상 패키지 파일명을 확인할 수 없습니다.');
        const path=join(target,file.name);await copyFile(file.path,path);if(await fileHash(path)!==file.sha)throw fail('저장 중 영상 구간이 변경되었습니다. 다시 요청해 주세요.');published.push({...file,path});
      }
      return {checkedAt:Date.now(),path:join(target,'index.m3u8'),directory:folder,files:published,fingerprint,format:'hls',bytes:published.reduce((n,x)=>n+x.bytes,0),reused};
    }catch(e){await rm(target,{recursive:true,force:true});throw e;}
  }
  throw fail('같은 이름의 영상 폴더가 너무 많습니다.');
}
