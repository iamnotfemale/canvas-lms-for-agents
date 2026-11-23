import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetup, saveConnection } from '../src/onboarding.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

async function env(t) {
  const root=await mkdtemp(join(tmpdir(),'canvas-setup-'));
  const values={CANVAS_AGENT_CONFIG_DIR:join(root,'config'),CANVAS_AGENT_DESKTOP_DIR:join(root,'Desktop'),CANVAS_AGENT_DATA_DIR:join(root,'data'),CANVAS_AGENT_NO_BROWSER:'1'};
  const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  Object.assign(process.env,values);
  t.after(async()=>{for(const [k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;await rm(root,{recursive:true,force:true});});
  return root;
}
test('local setup rejects cross-origin posts, validates token, hides it from HTML, and creates desktop library',async t=>{
  const root=await env(t);let calls=0;
  const setup=await createSetup({validate:async token=>{calls++;assert.equal(token,'synthetic-test-token');}});
  t.after(()=>setup.close());
  const origin=new URL(setup.url).origin;
  const initial = await fetch(setup.url); assert.equal(initial.status,200);
  const csrf = (await initial.text()).match(/name="csrf" value="([^"]+)"/)[1];
  assert.equal((await fetch(setup.url,{method:'POST',headers:{origin:'https://evil.example'},body:new URLSearchParams({token:'synthetic-test-token',csrf})})).status,403);
  assert.equal(calls,0);
  const response=await fetch(setup.url,{method:'POST',headers:{origin},body:new URLSearchParams({token:'synthetic-test-token',csrf})});
  const html=await response.text();assert.equal(response.status,200);assert.match(html,/연결이 완료/);assert.ok(!html.includes('synthetic-test-token'));assert.equal(calls,1);
  const settings=JSON.parse(await readFile(join(root,'config','config.json'),'utf8'));assert.equal(settings.token,'synthetic-test-token');assert.equal(settings.runtimeRoot,undefined);
  assert.ok((await stat(join(root,'Desktop','Canvas LMS'))).isDirectory());
  assert.equal((await fetch(setup.url,{method:'POST',headers:{origin},body:new URLSearchParams({token:'another',csrf})})).status,409);
});
test('failed verification does not overwrite existing credentials',async t=>{
  const root=await env(t);await saveConnection('old-test-token',{validate:async()=>{}});
  await assert.rejects(saveConnection('bad-test-token',{validate:async()=>{throw Error('Denied');}}));
  assert.equal(JSON.parse(await readFile(join(root,'config','config.json'),'utf8')).token,'old-test-token');
});
test('MCP resumes in the same session after setup without restart',async t=>{
  await env(t);
  const server=createServer({clientFactory:config=>({identity:async()=>{assert.equal(config.token,'new-test-token');return '1';}})});
  const host=new Client({name:'setup-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await host.connect(b);
  t.after(async()=>{await host.close();await server.close();});
  const before=await host.callTool({name:'connection_status',arguments:{}});assert.equal(JSON.parse(before.content[0].text).setupRequired,true);
  await saveConnection('new-test-token',{validate:async()=>{}});
  const after=await host.callTool({name:'connection_status',arguments:{}});assert.equal(JSON.parse(after.content[0].text).connected,true);
});
test('expired active connection offers setup and accepts the replacement token',async t=>{
  await env(t); await saveConnection('expired-test-token',{validate:async()=>{}});
  let expired=false;
  const server=createServer({clientFactory:config=>({identity:async()=>{
    if(expired && config.token==='expired-test-token') throw Object.assign(Error('Expired'),{status:401});
    return '1';
  }})});
  const host=new Client({name:'expiry-test',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await host.connect(b);
  t.after(async()=>{await host.close();await server.close();});
  assert.equal(JSON.parse((await host.callTool({name:'connection_status',arguments:{}})).content[0].text).connected,true);
  expired=true;
  assert.equal(JSON.parse((await host.callTool({name:'connection_status',arguments:{}})).content[0].text).setupRequired,true);
  await saveConnection('replacement-test-token',{validate:async()=>{}});
  assert.equal(JSON.parse((await host.callTool({name:'connection_status',arguments:{}})).content[0].text).connected,true);
});

test('privacy-restricted form posts need a session CSRF token; foreign and missing proof stay blocked',async t=>{
  await env(t);let calls=0;
  const setup=await createSetup({validate:async()=>{calls++;}});t.after(()=>setup.close());
  const csrf=(await (await fetch(setup.url)).text()).match(/name="csrf" value="([^"]+)"/)[1];
  const post=(origin,proof)=>fetch(setup.url,{method:'POST',headers:origin?{origin}:{},body:new URLSearchParams({token:'synthetic-token',csrf:proof})});
  assert.equal((await post('null','wrong')).status,403);
  assert.equal((await post(new URL(setup.url).origin,'')).status,403);
  assert.equal((await post('https://evil.example',csrf)).status,403);
  assert.equal(calls,0);
  assert.equal((await post('null',csrf)).status,200);assert.equal(calls,1);
});
test('missing Origin is supported only with the form proof and school 403 is explained without leaking errors',async t=>{
  await env(t);const setup=await createSetup({validate:async()=>{throw Object.assign(Error('private diagnostic'),{status:403});}});t.after(()=>setup.close());
  const csrf=(await (await fetch(setup.url)).text()).match(/name="csrf" value="([^"]+)"/)[1];
  const response=await fetch(setup.url,{method:'POST',body:new URLSearchParams({token:'synthetic-secret',csrf})});
  const html=await response.text();assert.equal(response.status,400);assert.match(html,/HTTP 403/);assert.ok(!html.includes('private diagnostic'));assert.ok(!html.includes('synthetic-secret'));
});
