import { mkdir, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, locked, atomicJson } from './cache.js';
import { desktopLibrary, safeName, courseFolder } from './paths.js';
import { fail, publicUrl } from './util.js';
import { videoUrl } from './video-source.js';
import { transferVideoAsset, publishVideoFile, readJson, ensureVideoDirectory } from './video-transfer.js';
import { downloadHls } from './video-hls.js';

export async function downloadVideo(client,cache,resourceId,{directory,maxBytes=5*1024**3,signal}={}) {
  if(!/^(file|lx):\d{1,30}:\d{1,30}$/.test(resourceId))throw fail('자료 검색에서 받은 영상 resourceId를 사용하세요.');
  const work=join(cache.root,'video-downloads',hash(resourceId));
  await ensureVideoDirectory(work);
  return locked(join(work,'download.lock'),async()=>{
    if(signal?.aborted)throw fail('다운로드 요청이 취소되었습니다.');
    // Access and item availability are checked even for a completely cached download.
    const source=await client.resolveVideo(resourceId);
    if(!Array.isArray(source.parts)||!source.parts.length||source.parts.length>100)throw fail('영상 원본 목록을 확인할 수 없습니다.');
    const base=directory||join(cache.libraryDir||await desktopLibrary(),safeName(source.term,'학기 미확인',40),courseFolder(source.courseName),source.week!=null?safeName(`${source.week}주차`,'주차 미확인',40):'주차 미확인');
    const folder=await ensureVideoDirectory(base),budget={used:0,max:maxBytes,signal};
    const statePath=join(work,'index.json'),old=await readJson(statePath,{parts:[]}),parts=[];
    const stem=safeName(String(source.title||'강의영상').replace(/\.(mp4|m4v|m3u8)$/i,''),'강의영상',100);
    for(const [index,part]of source.parts.entries()) {
      if(signal?.aborted)throw fail('다운로드 요청이 취소되었습니다.');
      videoUrl(part.url);
      const identity=hash(new URL(part.url).origin+new URL(part.url).pathname),previous=old.parts?.[index]?.identity===identity?old.parts[index]:null;
      const title=source.parts.length>1?`${stem} - ${String(index+1).padStart(2,'0')}`:stem;
      let result;
      if(part.format==='mp4') {
        const record=await transferVideoAsset(client,part.url,work,`part-${index}`,{previous,version:source.version||null,budget,mp4:true});
        result={...await publishVideoFile(record,folder,title+'.mp4'),reused:record.reused,format:'mp4'};
        await unlink(join(work,`part-${index}.part`)).catch(()=>{});
      }else if(part.format==='hls') {
        const hlsWork=join(work,`hls-${index}`);await mkdir(hlsWork,{recursive:true,mode:0o700});
        result=await downloadHls(client,part.url,hlsWork,folder,title,budget,previous);
        await rm(hlsWork,{recursive:true,force:true});
      }else throw fail('다운로드 가능한 MP4 또는 HLS 영상을 선택해 주세요.');
      parts.push({...result,identity});
      // Each completed chapter survives a failure in a later one.
      await atomicJson(statePath,{parts:[...parts,...(old.parts||[]).slice(index+1)]});
    }
    await atomicJson(statePath,{parts});
    const hasHls=parts.some(x=>x.format==='hls');
    return {resourceId,title:source.title,path:parts.length===1?parts[0].path:folder,directory:folder,files:parts.map(x=>({path:x.path,format:x.format,bytes:x.bytes})),bytes:parts.reduce((n,x)=>n+x.bytes,0),cacheHit:parts.every(x=>x.reused),sourceUrl:publicUrl(source.sourceUrl),
      ...(hasHls?{message:'HLS 영상은 index.m3u8과 영상 구간이 들어 있는 오프라인 폴더로 저장했습니다. VLC 등 HLS 재생을 지원하는 앱에서 index.m3u8을 여세요. 이동할 때 폴더 전체를 옮겨 주세요.'}:{})};
  });
}
