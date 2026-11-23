import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVideoMetadata,learningVideo,videoUrl} from '../src/video-source.js';
import {learningItem} from '../src/learningx.js';
import {Canvas} from '../src/canvas.js';
import {CANVAS,MEDIA} from '../src/util.js';
import {jsonResponse} from './fixtures.js';
const xml=body=>`<content><content_playing_info><content_id>abc123</content_id>${body}</content_playing_info></content>`;
test('Commons direct and signed sources stay internal; school metadata needs no player or tracking request',async()=>{
 const parts=parseVideoMetadata(xml(`<main_media><desktop><html5><method>progressive</method><media_uri auth_value="synthetic-media-secret">${MEDIA}/v/lecture.mp4</media_uri></html5></desktop><mobile><method>hls</method><media_uri>${MEDIA}/v/index.m3u8</media_uri></mobile></main_media>`),'abc123');
 assert.equal(parts.length,1);assert.equal(parts[0].format,'mp4');assert.equal(new URL(parts[0].url).searchParams.get('token'),'synthetic-media-secret');
 const item=learningItem({module_item_id:7,title:'Video',content_data:{item_content_data:{content_type:'readystream',view_url:MEDIA+'/em/abc123',video_url:MEDIA+'/private.mp4?token=synthetic-private'}}},'1',{title:'12주차',week_position:12});
 assert.ok(!JSON.stringify(item).includes('synthetic-private'));assert.ok(!JSON.stringify({...item}).includes('synthetic-private'));
 let calls=0;const resolved=await learningVideo({fetcher:async url=>{calls++;assert.equal(String(url),MEDIA+'/viewer/ssplayer/uniplayer_support/content.php?content_id=abc123');return new Response(xml(`<media_uri>${MEDIA}/v/lecture.mp4</media_uri>`));}},{video:true,viewer:MEDIA+'/em/abc123'});
 assert.equal(calls,1);assert.equal(resolved.parts[0].url,MEDIA+'/v/lecture.mp4');
});
test('ordered multipart story templates preserve every part and per-file authentication',()=>{
 const doc=`<content><content_playing_info><content_id>abc123</content_id><story_list><story><main_media_list><main_media auth_value="synthetic-part">two.mp4</main_media></main_media_list></story><story><main_media_list><main_media>one.mp4</main_media></main_media_list></story><story><main_media_list><main_media>two.mp4</main_media></main_media_list></story></story_list></content_playing_info><service_root><media><media_uri method="progressive">${MEDIA}/media/[MEDIA_FILE]</media_uri></media></service_root></content>`;
 const parts=parseVideoMetadata(doc,'abc123');assert.equal(parts.length,3);assert.equal(new URL(parts[0].url).pathname,'/media/two.mp4');assert.equal(new URL(parts[0].url).searchParams.get('token'),'synthetic-part');assert.equal(new URL(parts[1].url).pathname,'/media/one.mp4');assert.equal(new URL(parts[2].url).pathname,'/media/two.mp4');
});
test('foreign media hosts, XML entities, wrong IDs, unsupported providers and locked videos fail safely',async()=>{
 for(const url of ['http://127.0.0.1/x.mp4','https://evil.example/x.mp4','https://kucom.korea.ac.kr.evil.example/x.mp4','https://user:secret@kucom.korea.ac.kr/x.mp4'])assert.throws(()=>videoUrl(url));
 assert.throws(()=>parseVideoMetadata(xml(`<media_uri>https://evil.example/x.mp4</media_uri>`),'abc123'));
 assert.throws(()=>parseVideoMetadata(xml(`<media_uri>${MEDIA}/v.mp4</media_uri>`),'other'),/식별자/);
 assert.throws(()=>parseVideoMetadata('<!DOCTYPE a [<!ENTITY x "test">]>'+xml(''),'abc123'),/형식/);
 await assert.rejects(learningVideo({}, {locked:true,video:true}),/열람/);
 await assert.rejects(learningVideo({}, {video:true,viewer:'https://youtube.com/watch?v=example'}),/저장소/);
});
test('Canvas rechecks enrollment and weekly item access before resolving a video',async()=>{
 let accessible=true;const reads=[];
 const client=new Canvas('synthetic-school-token',{fetcher:async(url,options)=>{const u=new URL(url);reads.push(u.pathname);
 if(u.origin===CANVAS){assert.equal(options.headers.Authorization,'Bearer synthetic-school-token');if(u.pathname.endsWith('/users/self'))return jsonResponse({id:1});if(u.pathname==='/api/v1/courses')return jsonResponse(accessible?[{id:1,name:'미적분',term:{name:'2026년 2학기'}}]:[]);}
 throw Error('Unexpected request');}});
 client.weekly=async()=>[learningItem({module_item_id:7,title:'Lecture',content_data:{item_content_data:{content_type:'mp4',video_url:MEDIA+'/lecture.mp4'}}},'1',{week_position:12})];
 const first=await client.resolveVideo('lx:1:7');assert.equal(first.week,12);assert.equal(first.parts[0].format,'mp4');
 accessible=false;await assert.rejects(client.resolveVideo('lx:1:7'),/수강/);assert.equal(reads.filter(x=>x.endsWith('/users/self')).length,2);
});
