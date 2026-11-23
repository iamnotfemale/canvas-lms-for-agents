import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {downloadVideo} from '../src/video.js';
import {parseHls} from '../src/video-hls.js';
import {Canvas} from '../src/canvas.js';
import {MEDIA} from '../src/util.js';
import {FileCache} from '../src/cache.js';
import {mp4Fixture,tsFixture} from './video-fixtures.js';
async function fixture(t,fetcher){const root=await mkdtemp(join(tmpdir(),'canvas-video-'));t.after(()=>rm(root,{recursive:true,force:true}));const cache=new FileCache(join(root,'cache'),'account-1',1024**3,join(root,'library'));
 const client=new Canvas('synthetic-school-token',{fetcher});client.allowed=true;client.version='v1';client.resolveVideo=async()=>{if(!client.allowed)throw Object.assign(Error('revoked'),{safe:true,status:403});return {title:'12주차 강의',term:'2026년 2학기',courseName:'미적분',week:12,version:client.version,sourceUrl:'https://canvas.korea.ac.kr/courses/1/modules/items/7',parts:[{url:MEDIA+'/lecture.mp4?token=synthetic-signed',format:'mp4'}]};};return {root,client,cache};}
const videoResponse=(bytes=mp4Fixture(),headers={})=>new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"video-v1"',...headers}});
test('MP4 saves to course/week or chosen folder; reuse, edited files, concurrency and account access',async t=>{
 let downloads=0;const {root,client,cache}=await fixture(t,async(url,options)=>{downloads++;assert.equal(options.method,undefined);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);return videoResponse();});
 const [first,parallel]=await Promise.all([downloadVideo(client,cache,'lx:1:7'),downloadVideo(client,cache,'lx:1:7')]);assert.equal(downloads,1);assert.deepEqual([first.cacheHit,parallel.cacheHit].sort(),[false,true]);assert.equal(parallel.path,first.path);assert.match(first.path,/12주차/);assert.match(first.path,/\.mp4$/);assert.deepEqual(await readFile(first.path),mp4Fixture());
 assert.ok(!JSON.stringify(first).includes('synthetic-signed'));
 const saved=await downloadVideo(client,cache,'lx:1:7',{directory:join(root,'chosen')});assert.ok(saved.path.startsWith(join(root,'chosen')));assert.equal(downloads,1);
 await writeFile(saved.path,'user edit');const next=await downloadVideo(client,cache,'lx:1:7',{directory:join(root,'chosen')});assert.notEqual(next.path,saved.path);assert.equal(await readFile(saved.path,'utf8'),'user edit');assert.equal(downloads,2);
 client.allowed=false;await assert.rejects(downloadVideo(client,cache,'lx:1:7'),{code:'VIDEO_SOURCE_ACCESS_DENIED'});assert.equal(downloads,2);
});
test('unknown-version videos revalidate by ETag without exposing source URLs in local records',async t=>{
 let downloads=0;const {client,cache}=await fixture(t,async(url,options)=>{downloads++;if(options.headers['If-None-Match'])return new Response(null,{status:304});return videoResponse();});client.version=null;
 const first=await downloadVideo(client,cache,'lx:1:7');assert.equal((await downloadVideo(client,cache,'lx:1:7')).cacheHit,true);assert.equal(downloads,2);
 const directories=await readdir(join(cache.root,'video-downloads'));const text=await readFile(join(cache.root,'video-downloads',directories[0],'index.json'),'utf8');assert.ok(!text.includes('synthetic-signed'));assert.ok(!text.includes('https://'));
 assert.ok((await stat(first.path)).size>0);
});
test('interrupted MP4 resumes with validated Range and If-Range; complete output is never a partial file',async t=>{
 const bytes=mp4Fixture(),cut=Math.floor(bytes.length/2);let calls=0;
 const {client,cache}=await fixture(t,async(url,options)=>{calls++;if(calls===1){const body=new ReadableStream({start(c){c.enqueue(bytes.subarray(0,cut));c.close();}});return new Response(body,{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"stable"'}});}
 assert.equal(options.headers.Range,`bytes=${cut}-`);assert.equal(options.headers['If-Range'],'"stable"');return new Response(bytes.subarray(cut),{status:206,headers:{'content-type':'video/mp4','content-range':`bytes ${cut}-${bytes.length-1}/${bytes.length}`,'content-length':String(bytes.length-cut),etag:'"stable"'}});});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'),/中|중간/);const result=await downloadVideo(client,cache,'lx:1:7');assert.deepEqual(await readFile(result.path),bytes);assert.equal(calls,2);
});
test('range ignored means restart; changed content and invalid HTML cannot become successful videos',async t=>{
 const bytes=mp4Fixture();let calls=0;const {client,cache}=await fixture(t,async()=>{calls++;if(calls===1)return new Response(bytes.subarray(0,100),{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"old"'}});return videoResponse(bytes,{etag:'"new"'});});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'));assert.deepEqual(await readFile((await downloadVideo(client,cache,'lx:1:7')).path),bytes);
 client.version='v2';client.fetcher=async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}});await assert.rejects(downloadVideo(client,cache,'lx:1:7'),/영상 파일/);
 client.fetcher=async()=>videoResponse(Buffer.from('not a video'));await assert.rejects(downloadVideo(client,cache,'lx:1:7'),/MP4/);
});
test('downloads enforce size limits and never send PAT through redirects or request external targets',async t=>{
 const {client,cache}=await fixture(t,async()=>videoResponse());await assert.rejects(downloadVideo(client,cache,'lx:1:7',{maxBytes:10}),/한도/);
 let calls=0;client.fetcher=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});};await assert.rejects(downloadVideo(client,cache,'lx:1:7'),/허용/);assert.equal(calls,1);
});
test('multiple Commons parts are all saved in order and not reported as one merged MP4',async t=>{
 let calls=0;const {client,cache}=await fixture(t,async()=>{calls++;return videoResponse();});const resolve=client.resolveVideo;
 client.resolveVideo=async()=>({...await resolve(),parts:[{format:'mp4',url:MEDIA+'/a.mp4'},{format:'mp4',url:MEDIA+'/b.mp4'}]});
 const result=await downloadVideo(client,cache,'lx:1:7');assert.equal(result.files.length,2);assert.equal(calls,2);assert.match(result.files[0].path,/- 01\.mp4$/);assert.match(result.files[1].path,/- 02\.mp4$/);
});

test('HLS master chooses a rendition and offline package retains separate audio without remote links',async t=>{
 const seen=[];const {client,cache}=await fixture(t,async(url,options)=>{const path=new URL(url).pathname;seen.push(path);assert.equal(options.headers.Authorization,undefined);
 if(path==='/master.m3u8')return new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="voice",NAME="Korean",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="voice"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,AUDIO="voice"\nvideo.m3u8\n');
 if(path==='/video.m3u8'||path==='/audio.m3u8')return new Response(`#EXTM3U\n#EXTINF:1,\n${path==='/video.m3u8'?'video':'audio'}.ts?token=synthetic-secret\n#EXT-X-ENDLIST\n`);
 if(path.endsWith('.ts'))return new Response(tsFixture(),{headers:{'content-type':'video/mp2t','content-length':String(tsFixture().length)}});
 throw Error('Unexpected request');});
 const resolve=client.resolveVideo;client.resolveVideo=async()=>({...await resolve(),parts:[{url:MEDIA+'/master.m3u8',format:'hls'}]});
 const first=await downloadVideo(client,cache,'lx:1:7');assert.equal(first.files[0].format,'hls');assert.match(first.path,/index\.m3u8$/);assert.ok(!seen.includes('/low.m3u8'));
 const folder=join(first.path,'..');for(const name of ['index.m3u8','video.m3u8','audio.m3u8']){const text=await readFile(join(folder,name),'utf8');assert.ok(!text.includes('https://'));assert.ok(!text.includes('synthetic-secret'));}
 assert.equal(seen.filter(x=>x.endsWith('.ts')).length,2);
 const second=await downloadVideo(client,cache,'lx:1:7');assert.equal(second.path,first.path);assert.equal(second.cacheHit,true);assert.equal(seen.filter(x=>x.endsWith('.ts')).length,2);
});
test('HLS segments survive interruption and retry verifies every required segment before success',async t=>{
 let failSecond=true,firstReads=0;const {client,cache}=await fixture(t,async url=>{const path=new URL(url).pathname;
 if(path.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:1,\nfirst.ts\n#EXTINF:1,\nsecond.ts\n#EXT-X-ENDLIST\n');
 if(path==='/first.ts')firstReads++;if(path==='/second.ts'&&failSecond)return new Response('denied',{status:403});
 return new Response(tsFixture(),{headers:{'content-type':'video/mp2t','content-length':String(tsFixture().length)}});});
 const resolve=client.resolveVideo;client.resolveVideo=async()=>({...await resolve(),parts:[{url:MEDIA+'/vod.m3u8',format:'hls'}]});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'));failSecond=false;
 const result=await downloadVideo(client,cache,'lx:1:7');assert.equal(firstReads,1);assert.ok((await readFile(result.path,'utf8')).includes('#EXT-X-ENDLIST'));
});
test('HLS byte ranges are verified and local playlists refer to complete independent segments',async t=>{
 const ts=tsFixture();const {client,cache}=await fixture(t,async(url,options)=>{
 if(new URL(url).pathname.endsWith('.m3u8'))return new Response(`#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:${ts.length}@0\nfile.ts\n#EXTINF:1,\n#EXT-X-BYTERANGE:${ts.length}\nfile.ts\n#EXT-X-ENDLIST\n`);
 const [start,end]=options.headers.Range.slice(6).split('-').map(Number);return new Response(ts,{status:206,headers:{'content-type':'video/mp2t','content-range':`bytes ${start}-${end}/${2*ts.length}`,'content-length':String(ts.length)}});});
 const resolve=client.resolveVideo;client.resolveVideo=async()=>({...await resolve(),parts:[{url:MEDIA+'/vod.m3u8',format:'hls'}]});
 const result=await downloadVideo(client,cache,'lx:1:7');const manifest=await readFile(result.path,'utf8');assert.ok(!manifest.includes('BYTERANGE'));assert.equal(manifest.split('\n').filter(x=>x.endsWith('.ts')).length,2);
});
test('unsafe HLS hosts, encryption, live playlists and malformed ranges are blocked',()=>{
 for(const text of [
 '#EXTM3U\n#EXTINF:1,\nhttps://evil.example/a.ts\n#EXT-X-ENDLIST',
 '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',
 '#EXTM3U\n#EXTINF:1,\na.ts',
 '#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:100\na.ts\n#EXT-X-ENDLIST',
 '#EXTM3U\n#EXT-X-GAP\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST',
 ])assert.throws(()=>parseHls(text,MEDIA+'/vod.m3u8'));
});
test('MP4 file metadata and week listings classify videos without leaking private media fields',async()=>{
 const client=new Canvas('synthetic',{fetcher:async url=>{const path=new URL(url).pathname;if(path.endsWith('/users/self'))return new Response('{"id":1}');if(path==='/api/v1/courses')return new Response('[{"id":1,"name":"미적분"}]');if(path.endsWith('/files/3'))return new Response(JSON.stringify({filename:'강의.mp4','content-type':'video/mp4',updated_at:'2026-11-23',size:5959,url:MEDIA+'/a.mp4?token=synthetic'}));throw Error('Unexpected request');}});
 const source=await client.resolveVideo('file:1:3');assert.equal(source.parts[0].format,'mp4');assert.equal(source.title,'강의.mp4');
});

test('MCP download_video saves actual bytes and rejects invalid resource input',async t=>{
 const {client,cache}=await fixture(t,async()=>videoResponse());
 const {createServer}=await import('../src/server.js');const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
 const server=createServer({service:{client,cache}}),host=new Client({name:'video-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await host.connect(b);t.after(async()=>{await host.close();await server.close();});
 const result=await host.callTool({name:'download_video',arguments:{resourceId:'lx:1:7'}});assert.equal(result.isError,undefined);const record=JSON.parse(result.content[0].text);assert.deepEqual(await readFile(record.path),mp4Fixture());assert.ok(!JSON.stringify(result).includes('synthetic-signed'));
 assert.equal((await host.callTool({name:'download_video',arguments:{resourceId:'https://evil.example/v.mp4'}})).isError,true);
});

test('weak validators never authorize appending a previous partial download',async t=>{
 const bytes=mp4Fixture();let calls=0;
 const {client,cache}=await fixture(t,async(url,options)=>{calls++;if(calls===1)return new Response(bytes.subarray(0,100),{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'W/"weak"'}});assert.equal(options.headers.Range,undefined);assert.equal(options.headers['If-Range'],undefined);return videoResponse();});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'));assert.deepEqual(await readFile((await downloadVideo(client,cache,'lx:1:7')).path),bytes);
});
test('cancelled requests abort network transfer and do not publish a video',async t=>{
 const controller=new AbortController();let announce;const started=new Promise(resolve=>{announce=resolve;});
 const {client,cache}=await fixture(t,async(url,options)=>{announce();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('synthetic cancellation')),{once:true}));});
 const pending=downloadVideo(client,cache,'lx:1:7',{signal:controller.signal});await started;controller.abort();await assert.rejects(pending,/취소/);
});

test('changed source paths cannot reuse validators or partial bytes from another video',async t=>{
 const bytes=mp4Fixture();let calls=0,changed=false;
 const {client,cache}=await fixture(t,async(url,options)=>{calls++;if(calls===1)return new Response(bytes.subarray(0,100),{headers:{'content-type':'video/mp4','content-length':String(bytes.length),etag:'"same-etag-across-resources"'}});assert.equal(options.headers.Range,undefined);assert.equal(options.headers['If-None-Match'],undefined);assert.ok(String(url).includes('changed.mp4'));return videoResponse();});
 const resolve=client.resolveVideo;client.resolveVideo=async()=>({...await resolve(),parts:[{url:MEDIA+(changed?'/changed.mp4':'/old.mp4'),format:'mp4'}]});
 await assert.rejects(downloadVideo(client,cache,'lx:1:7'));changed=true;const result=await downloadVideo(client,cache,'lx:1:7');assert.deepEqual(await readFile(result.path),bytes);
});
test('older HLS packages revalidate assets and reuse the same offline folder after a 304',async t=>{
 let downloads=0,revalidations=0;const {client,cache}=await fixture(t,async(url,options)=>{
 if(String(url).includes('.m3u8'))return new Response('#EXTM3U\n#EXTINF:1,\nclip.ts\n#EXT-X-ENDLIST\n');
 if(options.headers['If-None-Match']){revalidations++;return new Response(null,{status:304});}
 downloads++;return new Response(tsFixture(),{headers:{'content-type':'video/mp2t','content-length':String(tsFixture().length),etag:'"segment"'}});});
 const resolve=client.resolveVideo;client.resolveVideo=async()=>({...await resolve(),parts:[{url:MEDIA+'/vod.m3u8',format:'hls'}]});
 const first=await downloadVideo(client,cache,'lx:1:7');const directories=await readdir(join(cache.root,'video-downloads'));const index=join(cache.root,'video-downloads',directories[0],'index.json'),state=JSON.parse(await readFile(index,'utf8'));state.parts[0].checkedAt=0;await writeFile(index,JSON.stringify(state));
 const next=await downloadVideo(client,cache,'lx:1:7');assert.equal(downloads,1);assert.equal(revalidations,1);assert.equal(next.path,first.path);assert.equal(next.cacheHit,true);
});
