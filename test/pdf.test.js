import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfFixture } from './fixtures.js';
import { readPdf, renderPage, indexPdf } from '../src/pdf.js';

test('full PDF indexing, page text, bounds and real PNG rendering', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-pdf-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'original.pdf'); await writeFile(path, pdfFixture());
  const file = { path, title: 'Synthetic learning PDF' };
  const indexed = await indexPdf(file, dir);
  assert.equal(indexed.totalPages, 2); assert.equal(indexed.indexCacheHit, false);
  assert.match(await readFile(indexed.textPath, 'utf8'), /Attention/);
  assert.equal((await indexPdf(file, dir)).indexCacheHit, true);
  const read = await readPdf(file, dir, 1, 2);
  assert.match(read.pages[0].text, /Memory/); assert.equal(read.pages[1].page, 2);
  await assert.rejects(readPdf(file, dir, 3, 3), /2쪽/);
  await assert.rejects(readPdf(file, dir, 1, 20), /1~8쪽/);
  const rendered = await renderPage(file, dir, 1);
  assert.equal(rendered.png.subarray(1, 4).toString(), 'PNG'); assert.ok(rendered.png.length > 1000);
  const reused = await renderPage(file, dir, 1); assert.deepEqual(reused.png, rendered.png);
});
