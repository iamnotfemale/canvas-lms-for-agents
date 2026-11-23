import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, stat, readFile, mkdir, unlink, copyFile, link, lstat, truncate } from 'node:fs/promises';
import { join, resolve, parse, isAbsolute } from 'node:path';
import { atomicJson, hash } from './cache.js';
import { fail } from './util.js';
import { safeName } from './paths.js';
import { videoUrl } from './video-source.js';

export async function fileHash(path) {const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
export async function readJson(path, fallback=null) {try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return fallback;throw e;}}
export async function validFile(record) {
  if(!record?.path||!Number.isSafeInteger(record.bytes)||!/^[a-f0-9]{64}$/.test(record.sha||''))return false;
  try {const info=await lstat(record.path);return info.isFile()&&info.size===record.bytes&&await fileHash(record.path)===record.sha;}catch(e){if(['ENOENT','EACCES','EPERM'].includes(e.code))return false;throw e;}
}
export async function ensureVideoDirectory(directory) {
  if(!isAbsolute(directory)||/[\x00-\x1f]/.test(directory))throw fail('이 컴퓨터에서 확인한 폴더의 절대 경로를 사용하세요.');
  const full=resolve(directory),root=parse(full).root;
  let current=root;
  for(const part of full.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current=join(current,part);await mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    if(!(await lstat(current)).isDirectory())throw fail('영상 저장 경로는 바로가기가 아닌 실제 폴더여야 합니다.');
  }
  return full;
}
export async function publishVideoFile(record,directory,title) {
  const folder=await ensureVideoDirectory(directory),name=safeName(title,'강의영상.mp4',120);
  for(let n=0;n<1000;n++) {
    const ext=parse(name).ext||'.mp4',stem=ext===parse(name).ext?name.slice(0,-ext.length):name;
    const path=join(folder,n?`${stem} (${n})${ext}`:name);
    const info=await lstat(path).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(info) {if(info.isFile()&&info.size===record.bytes&&await fileHash(path)===record.sha)return {...record,path,reused:true};continue;}
    const temp=join(folder,`.${randomUUID()}.part`);
    try {await copyFile(record.path,temp);if(await fileHash(temp)!==record.sha)throw fail('저장 중 영상 원본이 변경되었습니다. 다시 요청해 주세요.');await link(temp,path);return {...record,path,reused:false};}
    catch(e){if(e.code!=='EEXIST')throw e;}
    finally{await unlink(temp).catch(()=>{});}
  }
  throw fail('같은 이름의 영상이 너무 많습니다. 다른 폴더를 지정해 주세요.');
}
export async function validateMp4(path) {
  const file=await open(path,'r');
  try {
    const {size}=await file.stat();let offset=0,ftyp=false,moov=false,mdat=false,boxes=0;
    while(offset<size) {
      if(++boxes>100000)throw fail('영상 파일 구조가 너무 복잡합니다.');
      const head=Buffer.alloc(16),{bytesRead}=await file.read(head,0,Math.min(16,size-offset),offset);
      if(bytesRead<8)throw fail('MP4 영상 파일이 잘렸습니다.');
      let length=head.readUInt32BE(0);const kind=head.toString('ascii',4,8);let header=8;
      if(length===1){if(bytesRead<16)throw fail('MP4 영상 파일이 잘렸습니다.');const big=head.readBigUInt64BE(8);if(big>BigInt(Number.MAX_SAFE_INTEGER))throw fail('영상 크기가 너무 큽니다.');length=Number(big);header=16;}
      if(length===0)length=size-offset;
      if(length<header||offset+length>size)throw fail('MP4 영상 파일 길이가 올바르지 않습니다.');
      ftyp ||= kind==='ftyp';moov ||= kind==='moov';mdat ||= kind==='mdat'&&length>header;offset+=length;
    }
    if(!ftyp||!moov||!mdat)throw fail('학교 응답이 완전한 MP4 영상이 아닙니다. 로그인 또는 영상 권한을 확인해 주세요.');
  }finally{await file.close();}
}
const strongEtag=value=>value&&!value.startsWith('W/')?value:null;
const validator=record=>strongEtag(record?.etag)||record?.lastModified;

// Persist only validators, hashes and local paths: source URLs and credentials stay in memory.
export async function transferVideoAsset(client,url,work,key,{previous=null,version=null,range=null,budget,mp4=false,revalidate=false}={}) {
  videoUrl(url);await mkdir(work,{recursive:true,mode:0o700});
  const partial=join(work,key+'.part'),statePath=join(work,key+'.json');
  const sourceKey=hash(new URL(url).origin+new URL(url).pathname+JSON.stringify(range));
  if(previous?.sourceKey!==sourceKey)previous=null;
  const completed=await readJson(statePath);
  if(!previous && completed?.sha && completed.sourceKey===sourceKey)previous=completed;
  if(await validFile(previous)) {
    if(!revalidate&&version&&previous.version===version) {budget.used+=previous.bytes;if(budget.used>budget.max)throw fail('영상 다운로드 용량 한도를 초과했습니다.');return {...previous,reused:true};}
  }else previous=null;
  let state=await readJson(statePath),resume=0;
  const info=await stat(partial).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(info&&!range&&state?.sourceKey===sourceKey&&state?.version===version&&validator(state)&&state.partialSha&&Number.isSafeInteger(state.bytes)&&state.bytes>0&&info.size>=state.bytes) {
    await truncate(partial,state.bytes);
    if(await fileHash(partial)===state.partialSha)resume=state.bytes;
  }
  if(!resume){await unlink(partial).catch(()=>{});state=null;}
  const headers={'Accept-Encoding':'identity'};
  if(range)headers.Range=`bytes=${range.start}-${range.end}`;
  else if(resume){headers.Range=`bytes=${resume}-`;headers['If-Range']=validator(state);}
  else if(previous?.etag)headers['If-None-Match']=previous.etag;
  else if(previous?.lastModified)headers['If-Modified-Since']=previous.lastModified;
  let response;
  try {response=await client.openDownload({url},headers,15*60*1000,budget.signal);}
  catch(error){if(error.status===416&&resume){await unlink(partial).catch(()=>{});await unlink(statePath).catch(()=>{});return transferVideoAsset(client,url,work,key,{previous:null,version,range,budget,mp4});}throw error;}
  if(response.status===304&&previous){await response.body?.cancel();budget.used+=previous.bytes;if(budget.used>budget.max)throw fail('영상 다운로드 용량 한도를 초과했습니다.');return {...previous,version,reused:true};}
  if(response.status===304){await response.body?.cancel();throw fail('영상의 변경 확인 응답이 올바르지 않습니다.');}
  let start=resume,total;
  const contentRange=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if(range) {
    if(response.status!==206||!contentRange||Number(contentRange[1])!==range.start||Number(contentRange[2])!==range.end){await response.body?.cancel();throw fail('영상 서버가 요청한 구간을 올바르게 반환하지 않았습니다.');}
    start=0;total=range.end-range.start+1;
  }else if(response.status===206) {
    if(!resume||!contentRange||Number(contentRange[1])!==resume||Number(contentRange[2])!==Number(contentRange[3])-1||Number(contentRange[3])!==state.total){await response.body?.cancel();await unlink(partial).catch(()=>{});await unlink(statePath).catch(()=>{});throw fail('영상 이어받기 범위가 변경되었습니다. 다시 요청해 주세요.');}
    total=Number(contentRange[3]);
  }else if(response.status===200){start=0;total=response.headers.has('content-length')?Number(response.headers.get('content-length')):null;}
  else{await response.body?.cancel();throw fail('영상 다운로드 응답을 확인할 수 없습니다.');}
  if(total!==null&&(!Number.isSafeInteger(total)||total<=0||budget.used+total>budget.max)){await response.body?.cancel();throw fail('영상 크기가 비어 있거나 다운로드 용량 한도를 초과했습니다.');}
  if(/(?:text\/|json|xml)/i.test(response.headers.get('content-type')||'')||!response.body){await response.body?.cancel();throw fail('학교 응답이 영상 파일이 아닙니다. 로그인 또는 영상 접근 권한을 확인해 주세요.');}
  const record={sourceKey,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),version,total};
  if(resume&&start&&validator(record)!==validator(state)){await response.body.cancel();await unlink(partial).catch(()=>{});await unlink(statePath).catch(()=>{});throw fail('영상이 변경되어 이어받을 수 없습니다. 다시 요청해 주세요.');}
  const file=await open(partial,start?'a':'w',0o600);let bytes=start,checkpoint=start;
  const digest=createHash('sha256');
  try {
    if(start)for await(const chunk of createReadStream(partial))digest.update(chunk);
    for await(const chunk of response.body) {
      bytes+=chunk.length;if(budget.used+bytes>budget.max)throw fail('영상 다운로드 용량 한도를 초과했습니다.');
      await file.writeFile(chunk);digest.update(chunk);
      if(bytes-checkpoint>=16*1024*1024){await file.sync();await atomicJson(statePath,{...record,bytes,partialSha:digest.copy().digest('hex')});checkpoint=bytes;}
    }
    await file.sync();
    if(!bytes||(total!==null&&bytes!==total))throw fail('영상 다운로드가 중간에 끊겼습니다. 같은 요청을 보내면 안전하게 다시 시도합니다.');
  }catch(error) {
    await file.close();
    if(validator(record)&&total!==null&&bytes>0&&bytes<total&&budget.used+bytes<=budget.max)await atomicJson(statePath,{...record,bytes,partialSha:await fileHash(partial)});
    else{await unlink(partial).catch(()=>{});await unlink(statePath).catch(()=>{});}
    if(error.safe)throw error;
    throw fail('영상 다운로드가 중단되었습니다. 같은 요청을 다시 보내 주세요.');
  }finally{await file.close().catch(()=>{});}
  try {if(mp4)await validateMp4(partial);}
  catch(error){await unlink(partial).catch(()=>{});await unlink(statePath).catch(()=>{});throw error;}
  const sha=digest.digest('hex');budget.used+=bytes;
  const result={path:partial,bytes,sha,sourceKey,etag:record.etag,lastModified:record.lastModified,version,reused:false};
  await atomicJson(statePath,{...record,...result,partialSha:sha});
  return result;
}
