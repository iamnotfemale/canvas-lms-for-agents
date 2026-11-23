import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Canvas } from './canvas.js';
import { configDir, configFile, readSettings, restrictDirectory } from './config.js';
import { atomicJson, locked } from './cache.js';
import { desktopLibrary, supportDir } from './paths.js';
import { setupPage } from './setup-page.js';

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
export function openLocalPage(url) {
  let child;
  if (process.platform === 'win32') child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}
export async function createSetup({ validate, openBrowser = false, ttl = 600000 } = {}) {
  const key = randomBytes(24).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  const nonce = randomBytes(18).toString('base64');
  const page = (action, options = {}) => setupPage(action, csrf, { ...options, nonce });
  let origin, completed = null, pending = false, attempts = 0;
  const server = createServer(async (req, res) => {
    const respond = (status, html) => { res.writeHead(status, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Referrer-Policy':'same-origin', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` }); res.end(html); };
    if (req.headers.host !== new URL(origin).host || ![`/${key}`, `/${key}/done`].includes(req.url)) return respond(404, 'Not found');
    if (req.method === 'GET') return respond(200, page(`/${key}`, completed ? { done:true, folder:completed.libraryDir } : {}));
    if (req.method !== 'POST' || req.url !== `/${key}` || (req.headers.origin && req.headers.origin !== 'null' && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site' || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(403, page(`/${key}`, { error:'이 화면에서 보낸 요청인지 확인할 수 없어요. 채팅에서 연결 설정을 다시 열어 주세요.' }));
    if (completed) return respond(409, page(`/${key}`, { done:true, folder:completed.libraryDir }));
    if (pending || attempts >= 10) return respond(429, page(`/${key}`, { error:'연결 확인 중이거나 시도 횟수를 초과했어요. 잠시 뒤 채팅에서 연결 설정을 다시 열어 주세요.' }));
    pending = true; attempts++;
    try {
      let body = '';
      for await (const chunk of req) { body += chunk.toString('utf8'); if (Buffer.byteLength(body) > 16384) throw Error('입력이 너무 깁니다. 토큰만 입력해 주세요.'); }
      const fields = new URLSearchParams(body);
      const supplied = Buffer.from(fields.get('csrf') || '');
      if (supplied.length !== csrf.length || !timingSafeEqual(supplied, Buffer.from(csrf))) return respond(403, page(`/${key}`, { error:'연결 화면의 유효성을 확인하지 못했어요. 채팅에서 연결 설정을 다시 열어 주세요.' }));
      const token = fields.get('token');
      completed = await saveConnection(token, { validate });
      respond(200, page(`/${key}`, { done:true, folder:completed.libraryDir }));
    } catch (error) {
      const message = error.status === 401 ? '토큰이 만료되었거나 올바르지 않아요. Canvas에서 새 토큰을 발급해 주세요.'
        : error.status === 403 ? '학교가 계정 접근을 거절했어요 (HTTP 403). Canvas 로그인과 계정 권한을 확인해 주세요.'
        : ['EACCES', 'EPERM', 'ENOSPC'].includes(error.code) ? '설정 또는 PDF 저장 폴더에 쓸 수 없어요. 폴더 권한과 남은 공간을 확인해 주세요.'
        : '연결하지 못했어요. 토큰의 만료·오타와 학교 연결 상태를 확인한 뒤 다시 입력해 주세요.';
      respond(400, page(`/${key}`, { error:message }));
    }
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
