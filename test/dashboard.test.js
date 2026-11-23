import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDashboard} from '../src/dashboard.js';

test('dashboard serves local UI and authenticated paginated read APIs without exposing credentials',async t=>{
 const calls=[];const client={identity:async()=>{},courses:async()=>[{id:'1',name:'미적분학'}],overview:async(...args)=>{calls.push(args);return {items:[{title:'과제',submissionState:'missing'}],total:1,nextOffset:null};},boards:async()=>({boards:[{id:'2',title:'공지 게시판'}]})};
 const dashboard=await createDashboard({services:async()=>({client})});t.after(()=>dashboard.close());
 const html=await (await fetch(dashboard.url)).text();assert.match(html,/나의 수업/);assert.match(html,/미제출/);assert.ok(!html.includes('CANVAS_TOKEN'));
 const api=dashboard.url+'/api';
 assert.equal((await (await fetch(api+'?view=courses')).json()).courses[0].id,'1');
 assert.equal((await fetch(api+'?view=assignments&course=1&offset=20&submissionState=missing')).status,200);
 assert.deepEqual(calls[0],['1','assignments',false,20,undefined,'missing']);
 assert.equal((await fetch(api+'?view=boards&course=1')).status,200);
 assert.equal((await fetch(api+'?view=assignments&course=evil')).status,400);
 assert.equal((await fetch(api+'?view=assignments&course=1&offset=-1')).status,400);
 assert.equal((await fetch(api,{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await fetch(api,{method:'POST'})).status,403);
 assert.equal((await fetch(api.replace(/\/[^/]+\/api$/,'/wrong/api'))).status,404);
});
test('dashboard rechecks identity for every data request and reports expired credentials safely',async t=>{
 let allowed=true,calls=0;const client={identity:async()=>{if(!allowed)throw Object.assign(Error('secret diagnostics'),{status:401});},courses:async()=>{calls++;return [];}};
 const dashboard=await createDashboard({services:async()=>({client})});t.after(()=>dashboard.close());
 assert.equal((await fetch(dashboard.url+'/api?view=courses')).status,200);allowed=false;
 const response=await fetch(dashboard.url+'/api?view=courses');assert.equal(response.status,401);assert.equal(calls,1);assert.ok(!(await response.text()).includes('secret diagnostics'));
});
