import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { configFile } from '../src/config.js';
import { saveConnection } from '../src/onboarding.js';

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
  const { libraryDir } = await saveConnection(token);
  console.log(`연결 확인 완료. 설정: ${configFile()}\n자료: ${libraryDir}\n채팅으로 돌아가 요청을 이어가세요.`);
} catch (e) { muted = false; console.error(e.safe ? e.message : '설정 실패. 토큰·폴더 권한·학교 연결을 확인하세요.'); process.exitCode = 1; }
finally { rl.close(); }
