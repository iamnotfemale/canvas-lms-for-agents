import {fail} from './util.js';
export function videoFailure(error,{stage='download',referer=false}={}) {
  if(error.code==='SETUP_REQUIRED')return error;
  let code=error.safe&&error.code,message=error.safe?error.message:'영상 처리에 실패했습니다. 저장 폴더와 학교 접근 권한을 확인해 주세요.';
  if(!code){
    if(stage==='resolve'&&[401,403].includes(error.status)){code='VIDEO_SOURCE_ACCESS_DENIED';message='이 영상의 공급 경로에 접근할 수 없습니다. 전체 연결 만료를 뜻하지 않습니다.';}
    else if([401,403].includes(error.status)){code=referer?'VIDEO_CDN_ACCESS_DENIED':'VIDEO_CDN_REFERER_MISSING';message=referer?'학교 원본 페이지 헤더를 보냈지만 영상 저장소가 접근을 거절했습니다.':'영상 저장소가 접근을 거절했으며 검증된 원본 페이지 헤더가 없습니다.';}
    else if(error.status>=500||error.status===404){code='VIDEO_CANDIDATE_UNAVAILABLE';message='이 영상 후보의 서버가 응답하지 않거나 원본을 제공하지 않습니다.';}
    else if(['EACCES','EPERM','ENOSPC'].includes(error.code)){code='VIDEO_STORAGE_ERROR';message='영상 저장 폴더의 쓰기 권한과 남은 공간을 확인해 주세요.';}
    else code='VIDEO_DOWNLOAD_FAILED';
  }
  return Object.assign(fail(message,error.status),{code});
}
