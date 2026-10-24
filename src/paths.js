import { homedir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function desktopLibrary() {
  let desktop = process.env.CANVAS_AGENT_DESKTOP_DIR;
  if (!desktop && process.platform === 'win32') {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); [Environment]::GetFolderPath("DesktopDirectory")'], { windowsHide: true });
    desktop = stdout.trim();
  }
  if (!desktop && process.platform === 'linux') {
    try { desktop = (await promisify(execFile)('xdg-user-dir', ['DESKTOP'])).stdout.trim(); } catch { /* Desktop environments without XDG use ~/Desktop. */ }
  }
  return resolve(desktop || join(homedir(), 'Desktop'), 'Canvas LMS');
}
export async function supportDir() {
  if (process.env.CANVAS_AGENT_DATA_DIR) return resolve(process.env.CANVAS_AGENT_DATA_DIR);
  if (process.platform === 'win32') {
    try { await access('D:/Dev'); return 'D:/Dev/AppData/canvas-lms-for-agents'; } catch { /* Other users may have only a C drive. */ }
    return join(process.env.LOCALAPPDATA || homedir(), 'canvas-lms-for-agents');
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'canvas-lms-for-agents');
}
export async function npmCli() {
  const candidates = [resolve(process.execPath, '../node_modules/npm/bin/npm-cli.js'), resolve(process.execPath, '../../lib/node_modules/npm/bin/npm-cli.js')];
  for (const path of (process.env.PATH || '').split(delimiter)) candidates.push(join(path, 'node_modules/npm/bin/npm-cli.js'));
  for (const path of candidates) { try { await access(path); return path; } catch { /* Try the next installed Node location. */ } }
  throw Error('PDF 분석에 필요한 npm을 찾지 못했습니다. Node.js 24 이상을 설치하고 앱을 다시 시작하세요.');
}
export function safeName(value, fallback = '자료', length = 100) {
  let name = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!name || /^\.+$/.test(name)) name = fallback;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return [...name].slice(0, length).join('').replace(/[. ]+$/g, '') || fallback;
}
export function courseFolder(name) {
  return safeName(String(name || '').replace(/^\d{3}[A-Z]?\s*\([^)]*\)\s*/, '').replace(/\([A-Z][^)]*\)/g, '').replace(/-\s*(\d+분반)$/, ' - $1'), '과목 미확인', 70);
}
