import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { FileCache, locked } from '../src/cache.js';
import { fakeFiles, pdfFixture } from './fixtures.js';

async function fixture(t, account = '100') {
  const root = await mkdtemp(join(tmpdir(), 'canvas-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cache: new FileCache(root, account), client: fakeFiles() };
}
test('cache persists across server instances; concurrent requests download once', async t => {
  const { root, cache, client } = await fixture(t);
  const other = new FileCache(root, '100');
  const results = await Promise.all([cache.acquire(client, 'file:1:3'), other.acquire(client, 'file:1:3')]);
  assert.equal(client.downloads, 1); assert.equal(client.resolves, 2);
  assert.equal(results[0].path, results[1].path);
  assert.equal((await other.acquire(client, 'file:1:3')).cacheHit, true);
  assert.equal(client.downloads, 1);
});
test('updated file, corrupt cache and revoked access are handled', async t => {
  const { cache, client } = await fixture(t);
  const first = await cache.acquire(client, 'file:1:3');
  await writeFile(first.path, Buffer.alloc(first.bytes));
  const repaired = await cache.acquire(client, 'file:1:3');
  assert.equal(repaired.cacheHit, false); assert.equal(client.downloads, 2);
  client.version = 'v2'; client.body = pdfFixture('Chapter 3: Updated');
  const updated = await cache.acquire(client, 'file:1:3'); assert.notEqual(updated.sha, first.sha);
  client.allowed = false;
  await assert.rejects(cache.acquire(client, 'file:1:3'), /revoked/);
  assert.equal(client.downloads, 3);
});
test('identical content deduplicates, accounts stay isolated, clear removes derived files', async t => {
  const { root, cache, client } = await fixture(t);
  const a = await cache.acquire(client, 'file:1:3'), b = await cache.acquire(client, 'file:1:4');
  assert.equal(a.path, b.path); assert.equal((await cache.stats()).uniquePdfs, 1);
  const other = await new FileCache(root, '200').acquire(client, 'file:1:3'); assert.notEqual(a.path, other.path);
  await writeFile(join(cache.objectDir(a.sha), 'derived.md'), 'notes');
  await cache.prune(true); assert.equal((await cache.stats()).uniquePdfs, 0);
  await assert.rejects(readFile(a.path), { code: 'ENOENT' });
  assert.ok((await readFile(other.path)).length);
});
test('HTML and incomplete downloads never enter cache; temporary files cleaned', async t => {
  const { cache, client } = await fixture(t);
  client.body = Buffer.from('<html>Login</html>');
  await assert.rejects(cache.acquire(client, 'file:1:3'), /PDF/);
  client.openDownload = async () => new Response(pdfFixture(), { headers: { 'content-length': '99999' } });
  await assert.rejects(cache.acquire(client, 'file:1:3'), /끊겼/);
  assert.equal((await readdir(cache.root)).filter(x => x.endsWith('.part')).length, 0);
  assert.equal((await cache.stats()).resources, 0);
});
test('conditional 304 reuses PDF after TTL without downloading bytes', async t => {
  const { cache, client } = await fixture(t);
  client.version = null;
  const first = await cache.acquire(client, 'file:1:3');
  const index = await cache.index(); index['file:1:3'].checkedAt = 0;
  await writeFile(join(cache.root, 'index.json'), JSON.stringify(index));
  client.openDownload = async (_, headers) => { assert.equal(headers['If-None-Match'], 'fixture'); return new Response(null, { status: 304 }); };
  assert.equal((await cache.acquire(client, 'file:1:3')).path, first.path);
});
test('quota evicts least recently used whole document and keeps current one', async t => {
  const { cache, client } = await fixture(t);
  const old = await cache.acquire(client, 'file:1:3');
  cache.maxBytes = old.bytes + 100;
  client.body = pdfFixture('Chapter 9: Different');
  const latest = await cache.acquire(client, 'file:1:4');
  assert.notEqual(latest.sha, old.sha);
  assert.equal((await cache.stats()).resources, 1);
  await assert.rejects(readFile(old.path), { code: 'ENOENT' });
});
test('file lock protects writes across independent Node processes', async t => {
  const { root } = await fixture(t), lock = join(root, 'shared.lock'), count = join(root, 'count');
  await writeFile(count, '0');
  const moduleUrl = new URL('../src/cache.js', import.meta.url).href;
  const script = `import {locked} from ${JSON.stringify(moduleUrl)};import{readFile,writeFile}from'node:fs/promises';await locked(${JSON.stringify(lock)},async()=>{let n=Number(await readFile(${JSON.stringify(count)},'utf8'));await new Promise(r=>setTimeout(r,60));await writeFile(${JSON.stringify(count)},String(n+1));});`;
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' }); let err=''; child.stderr.on('data', x=>err+=x); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(err))); });
  await Promise.all([run(), run(), run()]); assert.equal(await readFile(count, 'utf8'), '3');
  await locked(lock, async () => assert.ok(true));
});

test('dead process lock is reclaimed and interrupted old downloads are pruned', async t => {
  const { cache } = await fixture(t); await cache.init();
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const dead = child.pid; await new Promise(resolve => child.on('exit', resolve));
  const lock = join(cache.root, 'dead.lock'); await writeFile(lock, String(dead));
  await Promise.all([locked(lock, async () => {}), locked(lock, async () => {})]);
  const partial = join(cache.root, 'abcdef.part'); await writeFile(partial, 'partial');
  const { utimes } = await import('node:fs/promises'); await utimes(partial, new Date(0), new Date(0));
  await cache.prune(); await assert.rejects(readFile(partial), { code: 'ENOENT' });
});
