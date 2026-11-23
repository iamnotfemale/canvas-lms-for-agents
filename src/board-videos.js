import {Parser} from 'htmlparser2';
import {MEDIA,CANVAS,safeUrl,plain,fail,id} from './util.js';
import {lectureDateFrom} from './video-dates.js';

export const boardVideoPattern=/^board:(\d{1,30}):(\d{1,30}):(\d{1,30}):([a-zA-Z0-9_-]{1,200})$/;
export function assertReadablePost(post) {
  if(post.locked||post.locked_for_user||post.published===false||post.permissions?.read===false)throw fail('현재 열람할 수 없는 게시글입니다.',403);
}
function embeddedVideos(post,course,makeId,extra) {
  assertReadablePost(post);const found=new Map(),text=plain(post.content||'');
  new Parser({onopentag(tag,attrs){
    if(tag!=='iframe'||attrs.srcdoc!==undefined||!attrs.src)return;
    try {
      const url=safeUrl(attrs.src,[MEDIA]);
      const contentId=url.pathname.match(/^\/em\/([a-zA-Z0-9_-]{1,200})\/?$/)?.[1];
      if(!contentId)return;
      const resourceId=makeId(contentId);
      const item={resourceId,courseId:course.id,...extra,title:post.title||attrs.title||'게시판 강의 영상',provider:'commons',video:true,pdf:false,locked:false,postedAt:post.created_at,url:`${CANVAS}/courses/${course.id}`,...lectureDateFrom({title:post.title,text,term:course.term})};
      // The canonical viewer is internal: neither iframe query strings nor signed URLs escape.
      Object.defineProperty(item,'viewer',{value:`${MEDIA}${url.pathname}`});
      found.set(resourceId,item);
    } catch { /* Unsupported embeds are never treated as downloadable school media. */ }
  }},{decodeEntities:true}).end(String(post.content||''));
  return [...found.values()];
}

export function boardVideos(post,course,boardId,postId) {
  return embeddedVideos(post,course,contentId=>`board:${id(course.id)}:${id(boardId)}:${id(postId)}:${contentId}`,{boardId:String(boardId),postId:String(postId)});
}
export const announcementVideoPattern=/^announcement:(\d{1,30}):(\d{1,30}):([a-zA-Z0-9_-]{1,200})$/;
export function announcementVideos(post,course) {
  return embeddedVideos({...post,content:post.message,created_at:post.posted_at},course,contentId=>`announcement:${id(course.id)}:${id(post.id)}:${contentId}`,{announcementId:String(post.id)});
}
