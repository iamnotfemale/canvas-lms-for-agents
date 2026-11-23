import { mkdir, unlink, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, locked, atomicJson } from './cache.js';
import { desktopLibrary, safeName, courseFolder } from './paths.js';
import { fail, publicUrl, errorInfo, mediaRequestHeaders } from './util.js';
import { videoUrl } from './video-source.js';
import { transferVideoAsset, publishVideoFile, readJson, ensureVideoDirectory } from './video-transfer.js';
import { downloadHls } from './video-hls.js';
import { validLectureDate, lectureDateFrom } from './video-dates.js';
import { videoFailure } from './video-errors.js';

export const videoResourcePattern=/^(?:(?:file|lx):\d{1,30}:\d{1,30}|board:\d{1,30}:\d{1,30}:\d{1,30}:[a-zA-Z0-9_-]{1,200}|announcement:\d{1,30}:\d{1,30}:[a-zA-Z0-9_-]{1,200})$/;
const publicFile=x=>({path:x.path,format:x.format,bytes:x.bytes,sha256:x.sha||undefined,resumedFrom:x.resumedFrom||0});

export async function downloadVideo(client,cache,resourceId,{directory,maxBytes=5*1024**3,signal,naming='title',lectureDate,onProgress=()=>{}}={}) {
  if(!videoResourcePattern.test(resourceId))throw fail('자료 검색에서 받은 영상 resourceId를 사용하세요.');
  if(!['title','lecture_date'].includes(naming)||lectureDate!==undefined&&!validLectureDate(lectureDate))throw Object.assign(fail('강의 날짜는 유효한 YYYY-MM-DD 형식으로 지정해 주세요.'),{code:'VIDEO_DATE_INVALID'});
  const work=join(cache.root,'video-downloads',hash(resourceId));await ensureVideoDirectory(work);
  return locked(join(work,'download.lock'),async()=>{
    if(signal?.aborted)throw fail('다운로드 요청이 취소되었습니다.');
    onProgress({phase:'resolving',resourceId});
    let source;try{source=await client.resolveVideo(resourceId);}catch(error){throw videoFailure(error,{stage:'resolve'});}
    if(!Array.isArray(source.parts)||!source.parts.length||source.parts.length>100)throw fail('영상 원본 목록을 확인할 수 없습니다.');
    const extracted=source.lectureDate?{lectureDate:source.lectureDate,lectureDateSource:source.lectureDateSource}:lectureDateFrom({title:source.title,term:source.term});
    const date=lectureDate||extracted.lectureDate;
    if(date&&!validLectureDate(date))throw Object.assign(fail('원문 강의 날짜를 확인해 주세요.'),{code:'VIDEO_DATE_INVALID'});
    if(naming==='lecture_date'&&!date)throw Object.assign(fail('원문에서 강의 날짜를 확정할 수 없습니다. 게시 시각 대신 확인한 강의 날짜를 지정해 주세요.'),{code:'VIDEO_DATE_REQUIRED'});
    const base=directory||join(cache.libraryDir||await desktopLibrary(),safeName(source.term,'학기 미확인',40),courseFolder(source.courseName),source.week!=null?safeName(`${source.week}주차`,'주차 미확인',40):'주차 미확인');
    const folder=await ensureVideoDirectory(base);let lastProgress=0;
    const budget={used:0,max:maxBytes,signal,onBytes:(bytes,total)=>{if(Date.now()-lastProgress>=1000){lastProgress=Date.now();onProgress({phase:'downloading',resourceId,bytes,total});}}};
    const statePath=join(work,'index.json'),old=await readJson(statePath,{parts:[]}),parts=[],attempts=[];
    const stem=naming==='lecture_date'?date:safeName(String(source.title||'강의영상').replace(/\.(mp4|m4v|m3u8)$/i,''),'강의영상',100);
    for(const [index,part]of source.parts.entries()) {
      if(signal?.aborted)throw fail('다운로드 요청이 취소되었습니다.');
      const title=source.parts.length>1?`${stem}${naming==='lecture_date'?'-':' - '}${String(index+1).padStart(2,'0')}`:stem;
      const candidates=part.candidates?.length?part.candidates:[part];let result,lastError,lastWork;
      for(const [candidateIndex,candidate]of candidates.entries()) {
        const headers=mediaRequestHeaders({headers:part.headers||source.headers});
        try {
          videoUrl(candidate.url);
          const identity=hash(new URL(candidate.url).origin+new URL(candidate.url).pathname),previous=old.parts?.[index]?.identity===identity?old.parts[index]:null;
          const key=`part-${index}-${identity.slice(0,12)}`;
          lastWork=join(work,key);
          onProgress({phase:'candidate',resourceId,part:index+1,totalParts:source.parts.length,candidate:candidateIndex+1});
          if(candidate.format==='mp4') {
            const record=await transferVideoAsset(client,candidate.url,work,key,{previous,version:source.version||null,budget,mp4:true,requestHeaders:headers});
            result={...await publishVideoFile(record,folder,title+'.mp4',{collision:naming==='lecture_date'?'hash':'number'}),reused:record.reused,format:'mp4'};
            await unlink(lastWork+'.part').catch(()=>{});
          }else if(candidate.format==='hls') {
            const hlsWork=join(work,'hls-'+key);await mkdir(hlsWork,{recursive:true,mode:0o700});lastWork=hlsWork;
            result=await downloadHls(client,candidate.url,hlsWork,folder,title,budget,previous,headers);
            await rm(hlsWork,{recursive:true,force:true});
          }else throw Object.assign(fail('지원하지 않는 영상 제공 형식입니다.'),{code:'VIDEO_PROVIDER_UNSUPPORTED'});
          result.identity=identity;break;
        }catch(error){
          lastError=videoFailure(error,{referer:!!headers.Referer});
          attempts.push({part:index+1,candidate:candidateIndex+1,method:['progressive','pseudo','hls'].includes(candidate.method)?candidate.method:candidate.format==='hls'?'hls':'mp4',target:['all','mobile','desktop','flash-fallback'].includes(candidate.target)?candidate.target:undefined,code:lastError.code,status:lastError.status});
          onProgress({phase:'candidate_failed',resourceId,part:index+1,candidate:candidateIndex+1,code:lastError.code,status:lastError.status});
          if(signal?.aborted||lastError.code==='VIDEO_STORAGE_ERROR')break;
        }
      }
      if(!result){
        const state=lastWork?await readJson(lastWork+'.json'):null;
        const partial=lastWork?await stat(lastWork+'.part').catch(()=>null):null;
        let hlsReusable=false;
        if(lastWork?.includes('hls-'))for(const name of await readdir(lastWork).catch(()=>[])){if(name.endsWith('.json')&&(await readJson(join(lastWork,name)))?.sha){hlsReusable=true;break;}}
        const retryState=partial?.size&&state?.partialSha&&(state.etag&&!state.etag.startsWith('W/')||state.lastModified)?'resume_available':hlsReusable?'segments_reusable':'retry_required';
        throw Object.assign(lastError||fail('영상 후보를 모두 처리하지 못했습니다.'),{details:{completedParts:parts.length,totalParts:source.parts.length,files:parts.map(publicFile),retryState,attempts}});
      }
      parts.push(result);
      await atomicJson(statePath,{parts:[...parts,...(old.parts||[]).slice(index+1)]});
      onProgress({phase:'part_completed',resourceId,part:index+1,totalParts:source.parts.length,bytes:result.bytes});
    }
    await atomicJson(statePath,{parts});
    const hasHls=parts.some(x=>x.format==='hls');
    const result={resourceId,title:source.title,path:parts.length===1?parts[0].path:folder,directory:folder,lectureDate:date||null,lectureDateSource:lectureDate?'provided':extracted.lectureDateSource,files:parts.map(publicFile),bytes:parts.reduce((n,x)=>n+x.bytes,0),cacheHit:parts.every(x=>x.reused),retryState:parts.some(x=>x.resumedFrom)?'resumed':parts.every(x=>x.reused)?'cached':'completed',attempts,sourceUrl:publicUrl(source.sourceUrl),
      ...(hasHls?{message:'HLS 영상은 index.m3u8과 영상 구간이 들어 있는 오프라인 폴더로 저장했습니다. VLC 등 HLS 재생을 지원하는 앱에서 index.m3u8을 여세요. 이동할 때 폴더 전체를 옮겨 주세요.'}:{})};
    onProgress({phase:'completed',resourceId,bytes:result.bytes});return result;
  });
}

export async function downloadVideos(client,cache,items,{directory,naming='lecture_date',signal,onProgress=()=>{}}={}) {
  if(!Array.isArray(items)||!items.length||items.length>50)throw fail('저장할 영상은 1~50개로 지정해 주세요.');
  const results=[];
  for(const [index,item]of items.entries()) {
    if(signal?.aborted)break;
    const progress=event=>onProgress({...event,item:index+1,totalItems:items.length});
    try {const result=await downloadVideo(client,cache,item.resourceId,{directory,naming,lectureDate:item.lectureDate,signal,onProgress:progress});results.push({status:'completed',...result});}
    catch(error){const failure={resourceId:item.resourceId,status:'failed',error:errorInfo(videoFailure(error,{stage:'resolve'}))};if(error.details)failure.error.details=error.details;results.push(failure);progress({phase:'failed',resourceId:item.resourceId,code:failure.error.code});}
  }
  const succeeded=results.filter(x=>x.status==='completed').length;
  return {total:items.length,succeeded,failed:results.length-succeeded,unrun:items.length-results.length,bytes:results.filter(x=>x.status==='completed').reduce((n,x)=>n+x.bytes,0),results};
}
