import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Canvas} from '../src/canvas.js';
import {FileCache,hash} from '../src/cache.js';
import {boardVideos} from '../src/board-videos.js';
import {DOWNLOAD_ORIGINS,CANVAS,LEARNINGX,MEDIA,mediaRequestHeaders} from '../src/util.js';
import {videoOrigins,parseVideoMetadata} from '../src/video-source.js';
import {downloadVideo,downloadVideos} from '../src/video.js';
import {lectureDateFrom} from '../src/video-dates.js';
import {learningItem} from '../src/learningx.js';
import {mp4Fixture,tsFixture} from './video-fixtures.js';
import {jsonResponse} from './fixtures.js';
const CDN='https://korea-cms-object.cdn.gov-ntruss.com';
const course={id:'1',name:'Synthetic course',term:'2026년 2학기'};
const xml=(id,body)=>`<content><content_playing_info><content_id>${id}</content_id>${body}</content_playing_info></content>`;
const post=(n=1)=>({id:String(n),title:`2026-09-${String(n).padStart(2,'0')} 강의`,created_at:'2026-11-23T00:00:00Z',content:`<iframe src="${MEDIA}/em/synthetic${n}?session=synthetic-iframe-secret"></iframe>`});
async function fixture(t,{download,posts=7}={}){
 const root=await mkdtemp(join(tmpdir(),'canvas-board-video-'));t.after(()=>rm(root,{recursive:true,force:true}));const requests=[];
 const state={removed:false,locked:false};
 const client=new Canvas('synthetic-canvas-pat',{fetcher:async(url,options)=>{
  const u=new URL(url);requests.push({origin:u.origin,path:u.pathname,headers:options.headers});assert.equal(options.method,undefined);
  if(u.origin===CANVAS){assert.equal(options.headers.Authorization,'Bearer synthetic-canvas-pat');if(u.pathname.endsWith('/users/self'))return jsonResponse({id:10});if(u.pathname==='/api/v1/courses')return jsonResponse([{id:1,name:course.name,term:{name:course.term}}]);if(u.pathname.endsWith('/files'))return jsonResponse({},401);if(u.pathname.endsWith('/modules'))return jsonResponse([]);if(u.pathname.endsWith('/discussion_topics'))return jsonResponse([{...post(1),message:post(1).content,is_announcement:true,posted_at:post(1).created_at}]);if(u.pathname.endsWith('/discussion_topics/1'))return jsonResponse({...post(1),message:state.removed?'':post(1).content,is_announcement:true,locked:state.locked});}
  if(u.origin===LEARNINGX){assert.equal(options.headers.Authorization,'Bearer synthetic-lx');if(u.pathname.endsWith('/boards'))return jsonResponse([{id:4,title:'강의자료실'}]);if(u.pathname.endsWith('/posts'))return jsonResponse({items:Array.from({length:posts},(_,i)=>post(i+1)),pagination:{page:1,total_pages:1}});if(/\/posts\/\d+$/.test(u.pathname)){const n=Number(u.pathname.split('/').at(-1));return jsonResponse({...post(n),content:state.removed?'':post(n).content,locked:state.locked});}}
  if(u.origin===MEDIA){assert.equal(options.headers?.Authorization,undefined);assert.equal(options.headers?.Cookie,undefined);assert.ok(u.pathname.endsWith('/content.php'));const id=u.searchParams.get('content_id');return new Response(xml(id,`<main_media><html5><method>progressive</method><media_uri>${CDN}/${id}.mp4?token=synthetic-cdn-secret</media_uri></html5></main_media>`));}
  if(u.origin===CDN){assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Referer,`${MEDIA}/em/${u.pathname.slice(1).split('.')[0]}`);if(download)return download(u,options);const bytes=mp4Fixture();return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"synthetic-etag"'}});}
  throw Error('Unexpected synthetic request');
 }});
 client.weekly=async()=>[];
 client.memo.values.set('session:1:boards',{expires:Infinity,value:new Map([['xn_api_token','synthetic-lx']])});
 const cache=new FileCache(join(root,'cache'),'synthetic-account',1024**3,join(root,'library'));
 return {client,cache,root,state,requests};
}
test('iframe-only posts expose stable board IDs and dates without iframe URLs or signatures',()=>{
 const raw={...post(1),content:post(1).content+`<iframe src="${MEDIA}/em/synthetic1"></iframe><iframe src="https://evil.example/em/x"></iframe><iframe srcdoc="ignored" src="${MEDIA}/em/ignored"></iframe>`};
 const videos=boardVideos(raw,course,'4','5');assert.equal(videos.length,1);assert.equal(videos[0].resourceId,'board:1:4:5:synthetic1');assert.equal(videos[0].lectureDate,'2026-09-01');assert.equal(videos[0].lectureDateSource,'title');assert.ok(!JSON.stringify(videos).includes('/em/'));assert.ok(!JSON.stringify(videos).includes('synthetic-iframe-secret'));
});
test('search finds board backups despite files 401 and reports each supply route independently',async t=>{
 const {client}=await fixture(t);const result=await client.materials('1',{query:'2026-09-01'},true);
 assert.equal(result.items[0].resourceId,'board:1:4:1:synthetic1');assert.equal(result.sources.files.status,'error');assert.equal(result.sources.files.httpStatus,401);assert.equal(result.sources.files.requiresTokenReplacement,false);assert.equal(result.sources.boards.status,'ok');assert.equal(result.sources.learningx.status,'ok');assert.equal(result.boardSearch.scannedPosts,7);assert.equal(result.boardSearch.truncated,false);assert.equal(await client.identity(true),'10');
 const detail=await client.boards('1','4','1',1,true);assert.equal(detail.text,'');assert.deepEqual(detail.attachments,[]);assert.equal(detail.videos.length,1);
});
test('board video downloads recheck the live post before every cache hit and after removal',async t=>{
 const {client,cache,state,requests}=await fixture(t);const first=await downloadVideo(client,cache,'board:1:4:1:synthetic1');assert.deepEqual(await readFile(first.path),mp4Fixture());
 const before=requests.filter(x=>x.origin===CDN).length;state.removed=true;await assert.rejects(downloadVideo(client,cache,'board:1:4:1:synthetic1'),{code:'VIDEO_SOURCE_ACCESS_DENIED'});assert.equal(requests.filter(x=>x.origin===CDN).length,before);
 state.removed=false;state.locked=true;await assert.rejects(downloadVideo(client,cache,'board:1:4:1:synthetic1'),{code:'VIDEO_SOURCE_ACCESS_DENIED'});
});
test('Canvas announcements preserve embedded videos and use their own permission-checked IDs',async t=>{
 const {client,cache,state}=await fixture(t);const notice=await client.overview('1','announcements',true);const item=notice.items[0].videos[0];assert.equal(item.resourceId,'announcement:1:1:synthetic1');assert.equal(notice.items[0].text,'');
 const result=await downloadVideo(client,cache,item.resourceId);assert.deepEqual(await readFile(result.path),mp4Fixture());state.removed=true;await assert.rejects(downloadVideo(client,cache,item.resourceId),{code:'VIDEO_SOURCE_ACCESS_DENIED'});
});
test('one shared origin list and Referer-only headers apply to Range and redirected CDN requests',async()=>{
 assert.equal(videoOrigins,DOWNLOAD_ORIGINS);assert.ok(DOWNLOAD_ORIGINS.includes(CDN));const referer=MEDIA+'/em/source';let calls=0;
 const client=new Canvas('synthetic-never-to-cdn',{fetcher:async(url,options)=>{calls++;assert.equal(options.headers.Referer,referer);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Range,'bytes=0-99');return calls===1?new Response(null,{status:302,headers:{location:CDN+'/clip.mp4'}}):new Response(Buffer.alloc(100),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-99/100'}});}});
 const response=await client.openDownload({url:MEDIA+'/clip.mp4',headers:{Referer:referer,Authorization:'secret',Cookie:'secret'}},{Range:'bytes=0-99',Authorization:'secret'});assert.equal(response.status,206);assert.equal(calls,2);
 assert.throws(()=>mediaRequestHeaders({headers:{Referer:'https://evil.example/em/source'}}),{code:'VIDEO_INVALID_REFERER'});
 assert.throws(()=>mediaRequestHeaders({headers:{Referer:referer+'?token=secret'}}),{code:'VIDEO_INVALID_REFERER'});
});
test('progressive/all and mobile candidates are retained in order and failures fall back safely',async t=>{
 const {client,cache}=await fixture(t);const candidates=parseVideoMetadata(xml('abc',`<main_media><fallback><method>pseudo</method><media_uri>${CDN}/pseudo.mp4?token=synthetic-secret</media_uri></fallback><desktop><method>progressive</method><media_uri>${CDN}/all.mp4?token=synthetic-secret</media_uri></desktop><mobile><method>progressive</method><media_uri>${CDN}/mobile.mp4?token=synthetic-secret</media_uri></mobile></main_media>`),'abc');
 assert.deepEqual(candidates[0].candidates.map(x=>new URL(x.url).pathname),['/all.mp4','/mobile.mp4','/pseudo.mp4']);
 client.resolveVideo=async()=>({title:'Lecture',version:null,parts:candidates.map(x=>({...x,headers:{Referer:MEDIA+'/em/abc'}}))});
 const calls=[];client.fetcher=async(url,options)=>{const path=new URL(url).pathname;calls.push(path);assert.equal(options.headers.Referer,MEDIA+'/em/abc');return path==='/all.mp4'?new Response(null,{status:503}):new Response(mp4Fixture(),{headers:{'content-type':'video/mp4','content-length':String(mp4Fixture().length)}});};
 const result=await downloadVideo(client,cache,'lx:1:7');assert.equal(result.attempts.length,1);assert.equal(result.attempts[0].status,503);assert.equal(result.attempts[0].code,'VIDEO_CANDIDATE_UNAVAILABLE');assert.ok(!calls.includes('/pseudo.mp4'));assert.ok(!JSON.stringify(result).includes('synthetic-secret'));assert.ok(!JSON.stringify(result).includes(CDN));
});
test('seven lecture-date saves confirm actual filesystem sizes and SHA-256; one failed item can resume',async t=>{
 let interrupted=false;const bytes=mp4Fixture(),cut=1000;const events=[];
 const {client,cache,root}=await fixture(t,{download:(url,options)=>{
  if(url.pathname==='/synthetic3.mp4'&&!interrupted){interrupted=true;return new Response(bytes.subarray(0,cut),{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"synthetic-etag"'}});}
  if(options.headers.Range){assert.equal(url.pathname,'/synthetic3.mp4');assert.equal(options.headers.Range,`bytes=${cut}-`);return new Response(bytes.subarray(cut),{status:206,headers:{'content-type':'video/mp4','content-length':String(bytes.length-cut),'content-range':`bytes ${cut}-${bytes.length-1}/${bytes.length}`,etag:'"synthetic-etag"'}});}
  return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"synthetic-etag"'}});
 }});
 const items=Array.from({length:7},(_,i)=>({resourceId:`board:1:4:${i+1}:synthetic${i+1}`}));const directory=join(root,'dated');
 const result=await downloadVideos(client,cache,items,{directory,naming:'lecture_date',onProgress:event=>events.push(event)});assert.equal(result.succeeded,6);assert.equal(result.failed,1);assert.equal(result.results[2].error.details.retryState,'resume_available');assert.equal(result.bytes,6*bytes.length);
 const retry=await downloadVideos(client,cache,[items[2]],{directory,naming:'lecture_date'});assert.equal(retry.succeeded,1);assert.equal(retry.results[0].retryState,'resumed');
 const files=await readdir(directory);assert.equal(files.length,7);for(let n=1;n<=7;n++){const path=join(directory,`2026-09-${String(n).padStart(2,'0')}.mp4`);assert.equal((await stat(path)).size,bytes.length);assert.equal(hash(await readFile(path)),hash(bytes));}
 assert.ok(events.some(x=>x.phase==='failed'&&x.item===3));assert.ok(events.some(x=>x.phase==='completed'&&x.item===7));assert.ok(!JSON.stringify(result).includes('synthetic-cdn-secret'));
});
test('date extraction distinguishes lecture date, publication timestamp and ambiguous dates',()=>{
 assert.equal(lectureDateFrom({title:'10월 29일 강의',term:'2026년 2학기'}).lectureDate,'2026-10-29');assert.equal(lectureDateFrom({title:'강의',text:'2026-11-03 수업'}).lectureDate,'2026-11-03');assert.equal(lectureDateFrom({title:'10/29, 11/3 강의',term:'2026년'}).lectureDate,null);assert.equal(lectureDateFrom({title:'10/29 강의'}).lectureDate,null);assert.equal(lectureDateFrom({title:'2026-02-30 강의'}).lectureDate,null);assert.equal(lectureDateFrom({title:'PDF 3-5',term:'2026년'}).lectureDate,null);assert.equal(lectureDateFrom({title:'자료',text:'https://example.test/2026/09/12'}).lectureDate,null);
});
test('weekly completion and attendance remain independent and unknown is preserved',()=>{
 const item=learningItem({module_item_id:1,title:'Video',completion_determinable:true,completed:true,attendance_status:'absent',content_data:{use_attendance:true,item_content_data:{content_type:'mp4'}}},'1',{week_position:1});assert.equal(item.completed,true);assert.equal(item.attendance,'결석');
 const unknown=learningItem({module_item_id:2,completed:false,completion_determinable:false,content_data:{item_content_data:{content_type:'mp4'}}},'1',{});assert.equal(unknown.completed,null);assert.equal(unknown.attendance,'확인 불가');
});

test('HLS manifests, byte ranges and segments all retain the validated Referer without credentials',async t=>{
 const {client,cache}=await fixture(t);const ref=MEDIA+'/em/hls';let segments=0;const bytes=tsFixture();
 client.resolveVideo=async()=>({title:'Streaming lecture',version:null,parts:[{url:CDN+'/index.m3u8',format:'hls',headers:{Referer:ref,Authorization:'synthetic-denied-pat',Cookie:'synthetic-denied-cookie'}}]});
 client.fetcher=async(url,options)=>{assert.equal(options.headers.Referer,ref);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);if(String(url).includes('.m3u8'))return new Response(`#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:${bytes.length}@0\nclip.ts\n#EXT-X-ENDLIST\n`);segments++;assert.equal(options.headers.Range,`bytes=0-${bytes.length-1}`);return new Response(bytes,{status:206,headers:{'content-type':'video/mp2t','content-range':`bytes 0-${bytes.length-1}/${bytes.length}`,'content-length':String(bytes.length)}});};
 const result=await downloadVideo(client,cache,'lx:1:7');assert.equal(segments,1);assert.ok((await readFile(result.path,'utf8')).includes('#EXT-X-ENDLIST'));assert.ok(!JSON.stringify(result).includes(ref));
});
test('missing Referer and CDN rejection with a valid Referer are distinct from whole-connection expiry',async t=>{
 const {client,cache}=await fixture(t);client.fetcher=async()=>new Response(null,{status:403});
 client.resolveVideo=async()=>({title:'Lecture',parts:[{url:CDN+'/clip.mp4?secret=synthetic-secret',format:'mp4'}]});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'),{code:'VIDEO_CDN_REFERER_MISSING'});
 client.resolveVideo=async()=>({title:'Lecture',parts:[{url:CDN+'/clip.mp4?secret=synthetic-secret',format:'mp4',headers:{Referer:MEDIA+'/em/valid'}}]});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'),error=>{assert.equal(error.code,'VIDEO_CDN_ACCESS_DENIED');assert.ok(!JSON.stringify(error.details).includes('synthetic-secret'));assert.ok(!JSON.stringify(error.details).includes(CDN));return true;});
});
test('date naming preserves multi-source order and never overwrites an edited same-date file',async t=>{
 const {client,cache,root}=await fixture(t);client.resolveVideo=async()=>({title:'2026-09-08 lecture',parts:[{url:CDN+'/synthetic1.mp4',format:'mp4',headers:{Referer:MEDIA+'/em/synthetic1'}},{url:CDN+'/synthetic2.mp4',format:'mp4',headers:{Referer:MEDIA+'/em/synthetic2'}}]});
 const directory=join(root,'dated-parts'),first=await downloadVideo(client,cache,'lx:1:7',{directory,naming:'lecture_date'});assert.ok(first.files[0].path.endsWith('2026-09-08-01.mp4'));assert.ok(first.files[1].path.endsWith('2026-09-08-02.mp4'));
 const {writeFile}=await import('node:fs/promises');await writeFile(first.files[0].path,'my edit');
 const next=await downloadVideo(client,cache,'lx:1:7',{directory,naming:'lecture_date'});assert.match(next.files[0].path,/2026-09-08-01 \([a-f0-9]{8}\)\.mp4$/);assert.equal(await readFile(first.files[0].path,'utf8'),'my edit');
});
test('a publication timestamp never silently replaces an unknown lecture date',async t=>{
 const {client,cache}=await fixture(t);client.resolveVideo=async()=>({title:'Lecture backup',postedAt:'2026-11-23T00:00:00Z',parts:[{url:CDN+'/synthetic1.mp4',format:'mp4',headers:{Referer:MEDIA+'/em/synthetic1'}}]});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7',{naming:'lecture_date'}),{code:'VIDEO_DATE_REQUIRED'});
 const explicit=await downloadVideo(client,cache,'lx:1:7',{naming:'lecture_date',lectureDate:'2026-09-10'});assert.ok(explicit.path.endsWith('2026-09-10.mp4'));assert.equal(explicit.lectureDateSource,'provided');
});
test('MCP connection stays healthy after a route-specific 401 and batch tool accepts actual board IDs',async t=>{
 const {client,cache,root}=await fixture(t);await client.materials('1',{},true);
 const {createServer}=await import('../src/server.js');const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');const server=createServer({service:{client,cache}}),host=new Client({name:'board-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await host.connect(b);t.after(async()=>{await host.close();await server.close();});
 const response=JSON.parse((await host.callTool({name:'connection_status',arguments:{}})).content[0].text);assert.equal(response.connected,true);assert.equal(response.sources['1'].files.httpStatus,401);assert.equal(response.setupRequired,undefined);
 const batch=await host.callTool({name:'download_videos',arguments:{items:[{resourceId:'board:1:4:1:synthetic1'}],directory:join(root,'batch')}});assert.equal(batch.isError,undefined);const result=JSON.parse(batch.content[0].text);assert.equal(result.succeeded,1);assert.ok(result.results[0].path.endsWith('2026-09-01.mp4'));
});

test('link-only announcement attachments require a fresh readable announcement reference',async()=>{
 let attached=true;const client=new Canvas('synthetic',{fetcher:async url=>{const path=new URL(url).pathname;if(path.endsWith('/users/self'))return jsonResponse({id:10});if(path==='/api/v1/courses')return jsonResponse([{id:1,name:'Synthetic course'}]);if(path.endsWith('/files/3'))return jsonResponse({hidden_for_user:true,filename:'notes.pdf',url:MEDIA+'/notes.pdf'});const notice={id:7,title:'Notice',is_announcement:true,message:attached?'<a href="/courses/1/files/3">notes.pdf</a>':''};if(path.endsWith('/discussion_topics'))return jsonResponse([notice]);if(path.endsWith('/discussion_topics/7'))return jsonResponse(notice);throw Error('Unexpected request');}});
 await assert.rejects(client.resolve('file:1:3'),/첨부 목록/);await client.overview('1','announcements',true);assert.ok((await client.resolve('file:1:3')).url);attached=false;await assert.rejects(client.resolve('file:1:3'),/더 이상/);
});

test('bounded board searches expose a continuation inside the same post page',async t=>{
 const {client}=await fixture(t,{posts:41});const first=await client.materials('1',{boardId:'4'},true);assert.equal(first.boardSearch.scannedPosts,40);assert.equal(first.boardSearch.truncated,true);assert.equal(first.boardSearch.scopes[0].nextPostOffset,40);assert.equal(first.sources.boards.status,'partial');
 const next=await client.materials('1',{boardId:'4',boardPostOffset:40},true);assert.equal(next.boardSearch.scannedPosts,1);assert.ok(next.items.some(x=>x.resourceId==='board:1:4:41:synthetic41'));
});
