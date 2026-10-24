import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopLibrary, supportDir } from './paths.js';

export const configDir = () => process.env.CANVAS_AGENT_CONFIG_DIR || join(homedir(), '.config', 'canvas-lms-for-agents');
export const configFile = () => join(configDir(), 'config.json');
export async function readSettings() {
  try { return JSON.parse(await readFile(configFile(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw Error('설정 파일을 읽지 못했습니다. 연결 설정을 다시 진행하세요.'); }
}
export async function restrictDirectory(path) {
  if (process.platform === 'win32') {
    const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username;
    await promisify(execFile)('icacls.exe', [path, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { windowsHide: true });
  }
}
export async function loadConfig() {
  const saved = await readSettings();
  const token = process.env.CANVAS_TOKEN || saved.token;
  if (!token || typeof token !== 'string' || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) {
    throw Object.assign(Error('학교 연결이 필요합니다. 로컬 연결 화면에 토큰을 입력하세요. 토큰을 채팅에 붙여 넣지 마세요.'), { code: 'SETUP_REQUIRED' });
  }
  const cacheDir = resolve(process.env.CANVAS_AGENT_CACHE_DIR || saved.cacheDir || join(await supportDir(), 'cache'));
  const libraryDir = resolve(saved.libraryDir || await desktopLibrary());
  const maxBytes = Number(saved.maxCacheMB ?? 1024) * 1024 * 1024;
  if (!Number.isFinite(maxBytes) || maxBytes < 128 * 1024 * 1024) throw Error('캐시 크기는 128 MB 이상이어야 합니다.');
  return { token, cacheDir, libraryDir, maxBytes, aliases: saved.aliases || {} };
}
