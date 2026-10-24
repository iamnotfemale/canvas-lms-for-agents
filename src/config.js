import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const configDir = () => process.env.CANVAS_AGENT_CONFIG_DIR || join(homedir(), '.config', 'canvas-lms-for-agents');
export const configFile = () => join(configDir(), 'config.json');
export async function restrictDirectory(path) {
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username;
    await promisify(execFile)('icacls.exe', [path, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true });
  }
}
export async function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(await readFile(configFile(), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw Error('설정 파일을 읽지 못했습니다. npm run setup으로 다시 설정하세요.'); }
  const token = process.env.CANVAS_TOKEN || saved.token;
  if (!token || typeof token !== 'string' || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) {
    throw Error('Canvas 토큰이 없습니다. 로컬 터미널에서 npm run setup을 실행하세요. 토큰을 채팅에 붙여 넣지 마세요.');
  }
  const cacheDir = resolve(process.env.CANVAS_AGENT_CACHE_DIR || saved.cacheDir || join(homedir(), '.cache', 'canvas-lms-for-agents'));
  const maxBytes = Number(saved.maxCacheMB ?? 1024) * 1024 * 1024;
  if (!Number.isFinite(maxBytes) || maxBytes < 128 * 1024 * 1024) throw Error('캐시 크기는 128 MB 이상이어야 합니다.');
  return { token, cacheDir, maxBytes, aliases: saved.aliases || {} };
}
