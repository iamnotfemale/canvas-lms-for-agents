import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dashboardPage } from './dashboard-page.js';
import { openLocalPage } from './onboarding.js';
import { errorInfo } from './util.js';

const kinds = ['announcements','assignments','weekly','attendance','syllabus','calendar'];
export async function createDashboard({services,openBrowser=false,ttl=3600000}) {
  const key=randomBytes(24).toString('hex'), nonce=randomBytes(18).toString('base64');
  let origin;
  const server=createServer(async(req,res)=>{
    const send=(status,body,json=false)=>{res.writeHead(status,{'Content-Type':json?'application/json; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`});res.end(json?JSON.stringify(body):body);};
    const url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host || req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin!==origin) || req.method!=='GET')return send(403,{message:'허용되지 않은 요청입니다.'},true);
    if(url.pathname===`/${key}`)return send(200,dashboardPage(`/${key}/api`,nonce));
    if(url.pathname!==`/${key}/api`)return send(404,{message:'페이지를 찾을 수 없습니다.'},true);
    try {
      const {client}=await services();await client.identity(true);
      const view=url.searchParams.get('view')||'courses',course=url.searchParams.get('course'),fresh=url.searchParams.get('fresh')==='true';
      const offset=Number(url.searchParams.get('offset')||0),page=Number(url.searchParams.get('page')||1);
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(page)||page<1||page>10000)return send(400,{message:'목록 범위를 확인해 주세요.'},true);
      if(view==='courses')return send(200,{courses:await client.courses('',fresh)},true);
      if(!/^\d{1,30}$/.test(course||''))return send(400,{message:'수강 과목을 먼저 선택해 주세요.'},true);
      if(view==='materials')return send(200,await client.materials(course,{},fresh,offset),true);
      if(view==='boards') {
        const board=url.searchParams.get('board')||undefined,post=url.searchParams.get('post')||undefined;
        if([board,post].some(x=>x&&!/^\d{1,30}$/.test(x)))return send(400,{message:'게시판 항목을 확인해 주세요.'},true);
        return send(200,await client.boards(course,board,post,page),true);
      }
      if(url.searchParams.has('submissionState') && !['all','missing','submitted','unknown','excused','not_required'].includes(url.searchParams.get('submissionState')))return send(400,{message:'제출 상태를 확인해 주세요.'},true);
      if(!kinds.includes(view))return send(400,{message:'지원하지 않는 메뉴입니다.'},true);
      return send(200,await client.overview(course,view,fresh,offset,undefined,url.searchParams.get('submissionState')||undefined),true);
    }catch(error){return send(error.code==='SETUP_REQUIRED'||error.status===401?401:502,{...errorInfo(error),message:error.code==='SETUP_REQUIRED'||error.status===401?'채팅에서 학교 연결 설정을 다시 열어 주세요.':errorInfo(error).message},true);}
  });
  server.requestTimeout=35000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  const url=`${origin}/${key}`,timer=setTimeout(()=>server.close(),ttl);timer.unref();server.unref();
  if(openBrowser)openLocalPage(url);
  return {url,expiresAt:new Date(Date.now()+ttl).toISOString(),close(){clearTimeout(timer);server.close();server.closeAllConnections();}};
}
