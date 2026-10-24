import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Canvas } from './canvas.js';
import { configDir, configFile, readSettings, restrictDirectory } from './config.js';
import { atomicJson, locked } from './cache.js';
import { desktopLibrary, supportDir } from './paths.js';

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export async function saveConnection(token, { validate = token => new Canvas(token).identity(true) } = {}) {
  if (typeof token !== 'string' || !token || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) throw Error('토큰을 확인해 주세요. 빈칸이나 공백을 포함할 수 없습니다.');
  await validate(token);
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await restrictDirectory(configDir());
  return locked(join(configDir(), 'settings.lock'), async () => {
    const old = await readSettings();
    delete old.runtimeRoot;
    const libraryDir = old.libraryDir || await desktopLibrary();
    const cacheDir = old.cacheDir || join(await supportDir(), 'cache');
    await mkdir(libraryDir, { recursive: true, mode: 0o700 });
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await atomicJson(configFile(), { ...old, token, libraryDir, cacheDir, maxCacheMB: old.maxCacheMB || 1024, aliases: old.aliases || {} });
    await chmod(configFile(), 0o600);
    return { libraryDir };
  });
}
function page(action, { error, done, folder } = {}) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas LMS 연결</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f6f4;color:#202321;margin:0;padding:48px 20px}main{max-width:480px;margin:auto;background:#fff;border:1px solid #ddd;border-radius:20px;padding:32px}h1{font-size:26px;line-height:1.4}p,li{line-height:1.7;font-size:15px}label{display:block;font-weight:600;margin-top:24px}input,button{font:inherit;box-sizing:border-box;width:100%;padding:14px;margin-top:10px;border-radius:9px}input{border:1px solid #777}button{background:#174b3c;color:white;border:0;font-weight:700;cursor:pointer}a{color:#174b3c}small{display:block;line-height:1.7;color:#555;margin-top:16px}.error{background:#fff0ee;color:#9b231b;padding:12px;border-radius:8px}code{overflow-wrap:anywhere}input:focus,button:focus,a:focus{outline:3px solid #3f9b7a;outline-offset:3px}</style>
<main><p>Canvas LMS for Agents · 고려대학교</p><h1>${done ? '학교 연결이 완료됐어요' : '학교 자료를 연결하세요'}</h1>
${done ? `<p>채팅으로 돌아가 요청을 이어가세요. 앱을 다시 시작할 필요는 없습니다.</p><p>PDF는 바탕화면의 <strong>Canvas LMS → 학기 → 과목</strong> 폴더에 원래 파일명으로 저장됩니다.</p><small><code>${escape(folder)}</code></small>` : `<p>개인 액세스 토큰을 한 번 입력하면 수업 자료와 공지, 출석을 확인할 수 있어요.</p><ol><li><a href="https://canvas.korea.ac.kr/profile/settings" target="_blank" rel="noreferrer">고려대 Canvas 설정 열기</a></li><li>승인된 통합에서 새 액세스 토큰을 만들어 복사하세요.</li></ol>${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}<form method="post" action="${action}" autocomplete="off"><label for="token">Canvas 개인 액세스 토큰</label><input id="token" name="token" type="password" required maxlength="4096" autocomplete="off" spellcheck="false" aria-describedby="privacy"><button type="submit">연결하고 시작하기</button></form><small id="privacy">이 화면은 본인 컴퓨터에서만 열립니다. 토큰은 학교에 연결을 확인한 뒤 로컬 설정에 저장하며 채팅으로 전달하지 않습니다. PDF 저장 위치: 바탕화면 → Canvas LMS → 학기 → 과목.</small>`}</main></html>`;
}
export function openLocalPage(url) {
  let child;
  if (process.platform === 'win32') child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}
export async function createSetup({ validate, openBrowser = false, ttl = 600000 } = {}) {
  const key = randomBytes(24).toString('hex');
  let origin, completed = null, pending = false, attempts = 0;
  const server = createServer(async (req, res) => {
    const respond = (status, html) => { res.writeHead(status, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }); res.end(html); };
    if (req.headers.host !== new URL(origin).host || ![`/${key}`, `/${key}/done`].includes(req.url)) return respond(404, 'Not found');
    if (req.method === 'GET') return respond(200, page(`/${key}`, completed ? { done:true, folder:completed.libraryDir } : {}));
    if (req.method !== 'POST' || req.url !== `/${key}` || req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(403, 'Forbidden');
    if (completed) return respond(409, page(`/${key}`, { done:true, folder:completed.libraryDir }));
    if (pending || attempts >= 10) return respond(429, page(`/${key}`, { error:'연결 확인 중이거나 시도 횟수를 초과했어요. 잠시 뒤 채팅에서 연결 설정을 다시 열어 주세요.' }));
    pending = true; attempts++;
    try {
      let body = '';
      for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 16384) throw Error('입력이 너무 깁니다. 토큰만 입력해 주세요.'); }
      const token = new URLSearchParams(body).get('token');
      completed = await saveConnection(token, { validate });
      respond(200, page(`/${key}`, { done:true, folder:completed.libraryDir }));
    } catch { respond(400, page(`/${key}`, { error:'연결하지 못했어요. 토큰의 만료·오타와 학교 연결 상태를 확인한 뒤 다시 입력해 주세요.' })); }
    finally { pending = false; }
  });
  server.requestTimeout = 35000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/${key}`;
  const timer = setTimeout(() => server.close(), ttl); timer.unref(); server.unref();
  if (openBrowser) openLocalPage(url);
  return { url, expiresAt: new Date(Date.now() + ttl).toISOString(), get connected() { return !!completed; }, close() { clearTimeout(timer); server.close(); server.closeAllConnections(); } };
}
let current;
export async function beginSetup(openBrowser = true) {
  if (!current || Date.parse(current.expiresAt) < Date.now() || current.connected) { current?.close(); current = await createSetup({ openBrowser }); }
  return { setupRequired: true, setupUrl: current.url, expiresAt: current.expiresAt, message:'로컬 연결 화면을 열었습니다. 거기에 토큰을 입력한 뒤 채팅에서 요청을 다시 이어가세요. 토큰을 채팅에 입력하지 마세요.' };
}
