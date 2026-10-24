import { Parser } from 'htmlparser2';
import { setTimeout as sleep } from 'node:timers/promises';

export const CANVAS = 'https://canvas.korea.ac.kr';
export const LEARNINGX = 'https://mylms.korea.ac.kr';
export const MEDIA = 'https://kucom.korea.ac.kr';
export function id(value) {
  if (!/^\d{1,30}$/.test(String(value))) throw Error('올바른 LMS ID가 아닙니다.');
  return String(value);
}
export function plain(html = '') {
  let out = '', hidden = 0;
  new Parser({
    onopentag(name) { if (['script', 'style'].includes(name)) hidden++; if (['p', 'br', 'li', 'div', 'tr'].includes(name)) out += '\n'; },
    ontext(text) { if (!hidden) out += text; },
    onclosetag(name) { if (['script', 'style'].includes(name)) hidden--; },
  }, { decodeEntities: true }).end(String(html));
  return out.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}
export function safeUrl(value, origins, prefix = '/') {
  const u = new URL(value);
  if (!origins.includes(u.origin) || u.username || u.password || u.hash || String(value).includes('\\') || !u.pathname.startsWith(prefix)) {
    throw Error('허용되지 않은 학교 주소입니다.');
  }
  return u;
}
export function publicUrl(value) {
  try {
    const u = safeUrl(value, [CANVAS, LEARNINGX, MEDIA]);
    u.search = ''; return u.href;
  } catch { return undefined; }
}
export function clipped(value, limit = 14000) {
  const text = String(value ?? '');
  return { text: text.slice(0, limit), truncated: text.length > limit, totalCharacters: text.length };
}
export function errorInfo(error) {
  return { message: error.safe ? error.message : '자료 조회에 실패했습니다. 연결 상태와 학교 접근 권한을 확인하세요.', status: error.status };
}
export function fail(message, status) {
  return Object.assign(Error(message), { safe: true, status });
}
export async function mapLimit(values, limit, callback) {
  let next = 0;
  const result = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) { const i = next++; if (i >= values.length) return; result[i] = await callback(values[i], i); }
  }));
  return result;
}
// Failed reads never replace a good value or masquerade as an empty list.
export class Memo {
  values = new Map(); pending = new Map();
  async get(key, ttl, read, fresh = false) {
    const hit = this.values.get(key);
    if (!fresh && hit && hit.expires > Date.now()) return hit.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const job = Promise.resolve().then(read).then(value => {
      if (this.values.size >= 300) this.values.delete(this.values.keys().next().value);
      this.values.set(key, { value, expires: Date.now() + ttl }); return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, job); return job;
  }
}
export async function request(fetcher, url, options = {}, { retries = 1, redirects = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
    catch { if (attempt < retries) { await sleep(250); continue; } throw fail('학교 서버 연결 시간이 초과되었거나 연결할 수 없습니다.'); }
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const delay = Math.min(2000, Math.max(250, Number(response.headers.get('retry-after')) * 1000 || 250));
      await response.body?.cancel(); await sleep(delay); continue;
    }
    if (response.ok || response.status === 304 || (redirects && [301, 302, 303, 307, 308].includes(response.status))) return response;
    await response.body?.cancel();
    throw fail(response.status === 401 ? '학교 인증 또는 이 자료의 권한을 확인할 수 없습니다. 연결 진단을 실행하세요.' : `학교 자료 조회 실패 (HTTP ${response.status}).`, response.status);
  }
}
