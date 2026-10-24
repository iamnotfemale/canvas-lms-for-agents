// Opt-in, read-only live verification. Outputs counts/timings only, never school content.
import { loadConfig } from '../src/config.js';
import { Canvas } from '../src/canvas.js';
import { FileCache } from '../src/cache.js';
import { indexPdf, readPdf, renderPage } from '../src/pdf.js';

const config = await loadConfig(), client = new Canvas(config.token, { aliases: config.aliases });
const account = await client.identity(true), cache = new FileCache(config.cacheDir, account, config.maxBytes, config.libraryDir);
const results = {};
const time = async (key, fn) => { const start = performance.now(); try { const result = await fn(); results[key] = { ok: true, ms: Math.round(performance.now() - start), ...result }; } catch (e) { results[key] = { ok: false, ms: Math.round(performance.now() - start), status: e.status, message: e.safe ? e.message : 'Failed; details suppressed' }; } console.log(JSON.stringify({ [key]: results[key] })); };
const courses = await client.courses();
console.log(JSON.stringify({ connected: true, courses: courses.length }));
let chosen, resourceId;
for (const course of courses.slice(0, 4)) {
  const materials = await client.materials(course.id);
  const pdf = materials.items.find(i => i.pdf && !i.locked);
  if (pdf) { chosen = course; resourceId = pdf.resourceId; results.materials = { ok: true, count: materials.total, partialSources: materials.warnings.map(w => w.source) }; break; }
}
if (!chosen) throw Error('No accessible PDF found in first four courses.');
console.log(JSON.stringify({ materials: results.materials }));
for (const kind of ['announcements', 'assignments', 'attendance', 'weekly']) await time(kind, async () => {
  const result = await client.overview(chosen.id, kind, true); return { count: result.total };
});
await time('boards', async () => ({ count: (await client.boards(chosen.id)).boards.length }));
await time('pdfCold', async () => {
  const file = await cache.acquire(client, resourceId); return { bytes: file.bytes, cacheHit: file.cacheHit };
});
await time('pdfWarm', async () => ({ cacheHit: (await cache.acquire(client, resourceId)).cacheHit }));
await time('indexFull', async () => { const d = await cache.withPdf(client, resourceId, indexPdf); return { pages: d.totalPages, indexCacheHit: d.indexCacheHit }; });
await time('indexWarm', async () => { const d = await cache.withPdf(client, resourceId, indexPdf); return { pages: d.totalPages, indexCacheHit: d.indexCacheHit }; });
await time('readPage', async () => { const d = await cache.withPdf(client, resourceId, (f, dir) => readPdf(f, dir, 1, 1)); return { pages: d.totalPages, characters: d.pages[0].text.length }; });
await time('renderPage', async () => { const d = await cache.withPdf(client, resourceId, (f, dir) => renderPage(f, dir, 1)); return { pngBytes: d.png.length }; });
if (Object.values(results).some(r => !r.ok)) process.exitCode = 1;
