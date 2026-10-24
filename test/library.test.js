import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCache } from '../src/cache.js';
import { safeName, courseFolder } from '../src/paths.js';
import { fakeFiles, pdfFixture } from './fixtures.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-library-')); t.after(() => rm(root,{recursive:true,force:true}));
  const client = fakeFiles(), original = client.resolve;
  client.resolve = async id => ({ ...await original(id), term:'2026년 2학기', courseName:'262R (서울-학부)미적분학II(CALCULUS II)-01분반', title:'Chapter13. Vector functions.pdf' });
  return {root, client, cache:new FileCache(join(root,'cache'),'1',1024**3,join(root,'Desktop','Canvas LMS'))};
}
test('PDFs use semester/course/real names, persist after cache clear, and restore without network download', async t => {
  const {client,cache} = await fixture(t);
  const first = await cache.acquire(client,'file:1:3');
  assert.match(first.path,/2026년 2학기/); assert.match(first.path,/미적분학II - 01분반/); assert.ok(first.path.endsWith('Chapter13. Vector functions.pdf'));
  await cache.prune(true); assert.ok((await readFile(first.path)).length);
  const second = await cache.acquire(client,'file:1:3'); assert.equal(second.path,first.path); assert.equal(second.cacheHit,true); assert.equal(client.downloads,1);
});
test('same-name different content and user edits are never overwritten', async t => {
  const {client,cache} = await fixture(t);
  const first = await cache.acquire(client,'file:1:3');
  await writeFile(first.path,'User annotated document');
  const restored = await cache.acquire(client,'file:1:3'); assert.notEqual(restored.path,first.path);
  assert.equal(await readFile(first.path,'utf8'),'User annotated document'); assert.equal(client.downloads,1);
  client.version='v2'; client.body=pdfFixture('New content');
  const different=await cache.acquire(client,'file:1:4'); assert.notEqual(different.path,restored.path);
  assert.notDeepEqual(await readFile(different.path),await readFile(restored.path));
});
test('concurrent apps share the same named copy; source path characters are harmless', async t => {
  const {root,client,cache}=await fixture(t);
  const second=new FileCache(join(root,'cache'),'1',1024**3,cache.libraryDir);
  const files=await Promise.all([cache.acquire(client,'file:1:3'),second.acquire(client,'file:1:3')]);
  assert.equal(files[0].path,files[1].path); assert.equal(client.downloads,1);
  assert.equal(safeName('../CON?.pdf'),'.._CON_.pdf'); assert.equal(safeName('CON'),'_CON'); assert.equal(safeName('..'),'자료');
  assert.equal(courseFolder('262R (서울-학부)미적분학II(CALCULUS II)-01분반'),'미적분학II - 01분반');
});
