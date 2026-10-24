import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat, readdir, rm, open, copyFile, lstat, link } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fail } from './util.js';
import { safeName, courseFolder } from './paths.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.part`;
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}
async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return fallback; throw e; }
}
export async function locked(path, fn, timeout = 120000) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(String(process.pid)); await handle.close();
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Only one contender can reclaim a dead owner; recheck after acquiring this gate.
      let recovery = false;
      try {
        await mkdir(`${path}.recovery`); recovery = true;
        const pid = Number(await readFile(path, 'utf8'));
        let stale = false;
        if (pid > 0) { try { process.kill(pid, 0); } catch (err) { stale = err.code === 'ESRCH'; } }
        else stale = Date.now() - (await stat(path)).mtimeMs > 120000;
        if (stale) await unlink(path);
      } catch (err) { if (!['ENOENT', 'EEXIST'].includes(err.code)) throw err; }
      finally { if (recovery) await rm(`${path}.recovery`, { recursive: true, force: true }); }
      if (Date.now() - started > timeout) throw fail('다른 앱에서 자료를 처리하고 있습니다. 잠시 후 다시 시도하세요.');
      await sleep(80);
    }
  }
  try { return await fn(); } finally { await unlink(path).catch(() => {}); }
}
async function sizeOf(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) bytes += await sizeOf(p);
    else if (entry.isFile()) bytes += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return bytes;
}
export class FileCache {
  constructor(root, accountId, maxBytes = 1024 ** 3, libraryDir) {
    this.root = join(root, hash(`canvas.korea.ac.kr:${accountId}`).slice(0, 32));
    this.maxBytes = maxBytes;
    this.libraryDir = libraryDir && resolve(libraryDir);
    this.accountKey = hash(`canvas.korea.ac.kr:${accountId}`).slice(0, 32);
  }
  async init() {
    await mkdir(join(this.root, 'objects'), { recursive: true, mode: 0o700 });
    if (this.libraryDir) await mkdir(this.libraryDir, { recursive: true, mode: 0o700 });
  }
  libraryIndex() { return json(join(this.libraryDir, '.canvas-library.json'), {}); }
  libraryKey(resourceId) { return `${this.accountKey}:${resourceId}`; }
  async libraryPath(parts) {
    let path = this.libraryDir;
    for (const part of parts) {
      path = resolve(path, part);
      const rel = relative(this.libraryDir, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw fail('자료 보관 경로를 확인할 수 없습니다.');
      const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (info?.isSymbolicLink()) throw fail('자료 보관 폴더의 바로가기 경로에는 저장하지 않습니다.');
    }
    return path;
  }
  async savedCopy(resourceId) {
    if (!this.libraryDir) return null;
    const row = (await this.libraryIndex())[this.libraryKey(resourceId)];
    if (!row || !Array.isArray(row.parts) || row.parts.length !== 3 || row.parts.some(p => typeof p !== 'string' || /[\\/]/.test(p))) return null;
    const path = await this.libraryPath(row.parts);
    const bytes = await readFile(path).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    return bytes && hash(bytes) === row.sha ? { ...row, path } : null;
  }
  async publish(resourceId, source, row, cachePath) {
    if (!this.libraryDir) return cachePath;
    return locked(join(this.libraryDir, '.library.lock'), async () => {
      const old = await this.savedCopy(resourceId);
      const parts = [safeName(source.term, '학기 미확인', 40), courseFolder(source.courseName)];
      let name = safeName(source.title, '강의자료.pdf');
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      const dir = await this.libraryPath(parts); await mkdir(dir, { recursive: true, mode: 0o700 });
      let target;
      if (old?.sha === row.sha && old.parts[0] === parts[0] && old.parts[1] === parts[1]) target = old.path;
      for (let n = 0; !target; n++) {
        const candidate = n === 0 ? name : `${name.replace(/\.pdf$/i, '')} (${hash(this.libraryKey(resourceId)).slice(0, 8)}-${row.sha.slice(0, 8)}${n > 1 ? '-' + n : ''}).pdf`;
        const path = await this.libraryPath([...parts, candidate]);
        const temp = join(dir, `.${randomUUID()}.part`);
        try {
          await copyFile(cachePath, temp);
          // Publish a complete independent copy without replacing user edits.
          await link(temp, path); target = path;
        }
        catch (e) {
          if (e.code !== 'EEXIST') throw e;
          if (hash(await readFile(path)) === row.sha) target = path;
        }
        finally { await unlink(temp).catch(() => {}); }
      }
      const index = await this.libraryIndex();
      index[this.libraryKey(resourceId)] = { ...row, parts: relative(this.libraryDir, target).split(/[\\/]/) };
      await atomicJson(join(this.libraryDir, '.canvas-library.json'), index);
      return target;
    });
  }
  async index() { return json(join(this.root, 'index.json'), {}); }
  objectDir(sha) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw fail('캐시 식별자가 손상되었습니다.');
    return join(this.root, 'objects', sha);
  }
  async stats() {
    await this.init();
    const index = await this.index();
    return { root: this.root, libraryDir: this.libraryDir, resources: Object.keys(index).length, uniquePdfs: new Set(Object.values(index).map(r => r.sha)).size, bytes: await sizeOf(this.root), maxBytes: this.maxBytes };
  }
  async maintain(keep, clear = false) {
    const index = await this.index();
    let bytes = await sizeOf(join(this.root, 'objects'));
    const entries = new Map();
    for (const row of Object.values(index)) entries.set(row.sha, Math.max(entries.get(row.sha) || 0, row.usedAt || 0));
    for (const entry of await readdir(join(this.root, 'objects'), { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && !entries.has(entry.name)) entries.set(entry.name, 0);
    }
    for (const [sha] of [...entries].sort((a, b) => a[1] - b[1])) {
      if (sha === keep || (!clear && bytes <= this.maxBytes)) continue;
      const dir = this.objectDir(sha), size = await sizeOf(dir);
      await rm(dir, { recursive: true, force: true }); bytes -= size;
      for (const [key, row] of Object.entries(index)) if (row.sha === sha) delete index[key];
    }
    await atomicJson(join(this.root, 'index.json'), index);
    return bytes;
  }
  async prune(clear = false) {
    await this.init();
    return locked(join(this.root, 'store.lock'), async () => {
      await this.maintain(undefined, clear);
      for (const name of await readdir(this.root)) {
        if (!/^[a-f0-9-]+\.part$/.test(name)) continue;
        const path = join(this.root, name), info = await stat(path).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 86400000) await unlink(path).catch(() => {});
      }
      return this.stats();
    });
  }
  async acquire(client, resourceId) {
    await this.init();
    return locked(join(this.root, `${hash(resourceId)}.lock`), async () => {
      // Authorization is checked even for a cache hit; revoked LMS access fails closed.
      const source = await client.resolve(resourceId);
      let previous = (await this.index())[resourceId];
      const saved = await this.savedCopy(resourceId);
      previous ||= saved;
      if (previous) {
        const path = join(this.objectDir(previous.sha), 'original.pdf');
        const s = await stat(path).catch(() => null);
        if (!s || s.size !== previous.bytes || hash(await readFile(path)) !== previous.sha) {
          if (saved?.sha === previous.sha) await locked(join(this.root, 'store.lock'), async () => {
            await mkdir(this.objectDir(previous.sha), { recursive: true, mode: 0o700 });
            await copyFile(saved.path, path);
          });
          else previous = null;
        }
      }
      let hit = previous && ((source.version && source.version === previous.version) || (!source.version && previous.checkedAt > Date.now() - 120000));
      let record = previous, downloaded = false;
      if (!hit) {
        const headers = {};
        if (previous?.etag) headers['If-None-Match'] = previous.etag;
        else if (previous?.lastModified) headers['If-Modified-Since'] = previous.lastModified;
        const response = await client.openDownload(source, headers);
        if (response.status === 304 && previous) { hit = true; await response.body?.cancel(); }
        else {
          const limit = Math.min(this.maxBytes, 100 * 1024 * 1024);
          const length = Number(response.headers.get('content-length'));
          if (length > limit) { await response.body?.cancel(); throw fail('PDF가 파일당 다운로드 한도(최대 100 MB)를 초과합니다.'); }
          const temp = join(this.root, `${randomUUID()}.part`);
          let bytes = 0, first = Buffer.alloc(0), digest = createHash('sha256');
          const file = await open(temp, 'wx', 0o600);
          try {
            if (!response.body) throw fail('빈 파일 응답입니다.');
            for await (const chunk of response.body) {
              const buffer = Buffer.from(chunk); bytes += buffer.length;
              if (bytes > limit) throw fail('PDF가 파일당 다운로드 한도를 초과합니다.');
              if (first.length < 1024) first = Buffer.concat([first, buffer.subarray(0, 1024 - first.length)]);
              digest.update(buffer); await file.writeFile(buffer);
            }
            if (!first.includes(Buffer.from('%PDF-'))) throw fail('학교 응답이 PDF가 아닙니다. 로그인 또는 자료 권한을 확인하세요.');
            if (length && bytes !== length) throw fail('PDF 다운로드가 중간에 끊겼습니다. 다시 시도하세요.');
            await file.sync(); await file.close();
            const sha = digest.digest('hex');
            record = { sha, bytes, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
            await locked(join(this.root, 'store.lock'), async () => {
              const dir = this.objectDir(sha); await mkdir(dir, { recursive: true, mode: 0o700 });
              const target = join(dir, 'original.pdf');
              const existing = await readFile(target).catch(() => null);
              if (!existing || hash(existing) !== sha) await rename(temp, target);
              await this.saveRecord(resourceId, { ...record, version: source.version, checkedAt: Date.now(), usedAt: Date.now(), title: source.title });
              await this.maintain(sha);
            });
            downloaded = true;
          } finally { await file.close().catch(() => {}); await unlink(temp).catch(() => {}); }
        }
      }
      if (!downloaded) await locked(join(this.root, 'store.lock'), async () => {
        await this.saveRecord(resourceId, { ...record, version: source.version, checkedAt: Date.now(), usedAt: Date.now(), title: source.title });
      });
      const cachePath = join(this.objectDir(record.sha), 'original.pdf');
      const row = { ...record, version: source.version, checkedAt: Date.now(), usedAt: Date.now(), title: source.title };
      const path = await locked(join(this.root, 'store.lock'), () => this.publish(resourceId, source, row, cachePath));
      return { resourceId, sha: record.sha, path, bytes: record.bytes, cacheHit: !downloaded, title: source.title, sourceUrl: source.sourceUrl };
    });
  }
  async saveRecord(resourceId, row) {
    const index = await this.index(); index[resourceId] = row;
    await atomicJson(join(this.root, 'index.json'), index);
  }
  async withPdf(client, resourceId, fn) {
    const file = await this.acquire(client, resourceId);
    // Serialize local PDF work with eviction; network downloads remain parallel.
    return locked(join(this.root, 'store.lock'), async () => {
      if (!(await stat(file.path).catch(() => null))) throw fail('캐시가 다른 앱에서 정리되었습니다. 다시 요청하세요.');
      const result = await fn(file, this.objectDir(file.sha));
      await this.maintain(file.sha);
      return result;
    });
  }
}
