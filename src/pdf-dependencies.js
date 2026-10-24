import { createRequire } from 'node:module';
import { mkdir, readFile, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supportDir, npmCli } from './paths.js';
import { hash, locked } from './cache.js';
import { fail } from './util.js';

export async function pdfRequire() {
  const local = createRequire(import.meta.url);
  try { local.resolve('pdfjs-dist/package.json'); local.resolve('@napi-rs/canvas'); return local; } catch { /* Packaged plugins install the PDF engine on first analysis. */ }
  let packaged;
  for (const url of [new URL('../pdf-runtime/', import.meta.url), new URL('../plugin/pdf-runtime/', import.meta.url)]) {
    try { await access(new URL('package-lock.json', url)); packaged = fileURLToPath(url); break; } catch { /* Development and packaged paths differ. */ }
  }
  if (!packaged) throw fail('PDF 분석 구성 파일이 없습니다. 플러그인을 업데이트해 주세요.');
  const lock = await readFile(join(packaged, 'package-lock.json'));
  const base = await supportDir(), root = join(base, 'pdf-runtime', hash(lock).slice(0, 16));
  const require = createRequire(join(root, 'package.json'));
  await mkdir(root, { recursive:true, mode:0o700 });
  await locked(join(root, 'install.lock'), async () => {
    try { require.resolve('pdfjs-dist/package.json'); require.resolve('@napi-rs/canvas'); return; } catch { /* First run or incomplete installation. */ }
    await copyFile(join(packaged, 'package.json'), join(root, 'package.json'));
    await copyFile(join(packaged, 'package-lock.json'), join(root, 'package-lock.json'));
    try {
      await promisify(execFile)(process.execPath, [await npmCli(), 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--cache', join(base, 'npm-cache')], { cwd:root, windowsHide:true, timeout:120000, maxBuffer:1024*1024 });
    } catch { throw fail('PDF 분석 도구를 자동 설치하지 못했습니다. 인터넷 연결과 Node.js/npm 설치를 확인한 뒤 다시 요청해 주세요.'); }
    require.resolve('pdfjs-dist/package.json'); require.resolve('@napi-rs/canvas');
  });
  return require;
}
