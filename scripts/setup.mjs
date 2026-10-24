import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { mkdir, readFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, configFile, restrictDirectory } from '../src/config.js';
import { atomicJson } from '../src/cache.js';
import { Canvas } from '../src/canvas.js';

if (!stdin.isTTY) { console.error('토큰을 보호하기 위해 대화형 로컬 터미널에서 실행하세요.'); process.exit(1); }
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: stdin, output, terminal: true });
try {
  let existing = {};
  try { existing = JSON.parse(await readFile(configFile(), 'utf8')); } catch { /* First setup. */ }
  stdout.write('Canvas LMS for Agents · 고려대학교\n토큰은 채팅·GitHub에 입력하지 마세요. 로컬 설정 파일에 저장됩니다.\n');
  stdout.write('Canvas 개인 토큰 (입력 숨김, Enter로 기존 값 유지): ');
  muted = true;
  const supplied = await rl.question(''); muted = false; stdout.write('\n');
  const token = supplied.trim() || existing.token;
  if (!token || /\s/.test(token) || token.length > 4096) throw Error('올바른 토큰을 입력하세요.');
  await new Canvas(token).identity(true);
  const defaultCache = existing.cacheDir || (process.platform === 'win32' ? resolve(process.env.LOCALAPPDATA || configDir(), 'canvas-lms-for-agents', 'cache') : resolve(configDir(), 'cache'));
  const cacheDir = resolve((await rl.question(`자료 저장 폴더 [${defaultCache}]: `)).trim() || defaultCache);
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await restrictDirectory(configDir());
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await atomicJson(configFile(), { ...existing, token, cacheDir, maxCacheMB: existing.maxCacheMB || 1024, runtimeRoot: fileURLToPath(new URL('..', import.meta.url)), aliases: existing.aliases || {} });
  await chmod(configFile(), 0o600);
  console.log(`연결 확인 완료. 설정: ${configFile()}\n자료: ${cacheDir}\n설치 안내대로 플러그인을 연결하고 앱을 다시 시작하세요.`);
} catch (e) { muted = false; console.error(e.safe ? e.message : '설정 실패. 토큰·폴더 권한·학교 연결을 확인하세요.'); process.exitCode = 1; }
finally { rl.close(); }
