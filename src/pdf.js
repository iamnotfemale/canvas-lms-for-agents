import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pdfRequire } from './pdf-dependencies.js';
import { atomicJson } from './cache.js';
import { fail, clipped } from './util.js';

let runtime;
async function pdfRuntime() {
  if (!runtime) runtime = (async () => {
    const require = await pdfRequire();
    const canvas = require('@napi-rs/canvas');
    globalThis.DOMMatrix ||= canvas.DOMMatrix;
    globalThis.ImageData ||= canvas.ImageData;
    globalThis.Path2D ||= canvas.Path2D;
    return { canvas, require, pdfjs: await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href) };
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}
async function openPdf(path) {
  const { pdfjs, require } = await pdfRuntime();
  const base = pathToFileURL(require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '')).href;
  return pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, verbosity: 0 }).promise;
}
export async function readPdf(file, dir, start = 1, end = start + 4) {
  if (start < 1 || end < start || end - start >= 8) throw fail('한 번에 PDF 1~8쪽을 읽을 수 있습니다.');
  const doc = await openPdf(file.path);
  try {
    if (start > doc.numPages) throw fail(`PDF는 ${doc.numPages}쪽입니다.`);
    let outline = await doc.getOutline();
    async function headings(nodes, depth = 0) {
      if (!nodes || depth > 4) return [];
      return Promise.all(nodes.slice(0, 80).map(async n => {
        let page = null;
        try { const d = typeof n.dest === 'string' ? await doc.getDestination(n.dest) : n.dest; if (d?.[0] != null) page = typeof d[0] === 'number' ? d[0] + 1 : await doc.getPageIndex(d[0]) + 1; } catch { /* Some PDFs contain broken bookmarks. */ }
        return { title: n.title, page, children: await headings(n.items, depth + 1) };
      }));
    }
    outline = await headings(outline);
    const pages = [];
    for (let number = start; number <= Math.min(end, doc.numPages); number++) {
      const cachePath = join(dir, `text-v1-${number}.json`);
      let data;
      try { data = JSON.parse(await readFile(cachePath, 'utf8')); } catch { /* Extract missing or damaged page caches. */ }
      if (!data || typeof data.text !== 'string') {
        const page = await doc.getPage(number), content = await page.getTextContent();
        const text = content.items.map(i => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join('').trim();
        data = { text }; await atomicJson(cachePath, data); page.cleanup();
      }
      pages.push({ page: number, ...clipped(data.text, 18000), visualReviewRecommended: data.text.length < 100 });
    }
    return { ...file, totalPages: doc.numPages, outline, pages, nextPage: Math.min(end, doc.numPages) < doc.numPages ? Math.min(end, doc.numPages) + 1 : null,
      note: '쪽수는 PDF 물리 페이지입니다. 그림·수식·표는 render_pdf_page로 확인하세요. OCR이나 전체 PDF 분석을 완료했다는 뜻이 아닙니다.' };
  } finally { await doc.loadingTask.destroy(); }
}
export async function renderPage(file, dir, number) {
  const doc = await openPdf(file.path);
  try {
    if (number < 1 || number > doc.numPages) throw fail(`PDF는 ${doc.numPages}쪽입니다.`);
    const target = join(dir, `page-v1-${number}.png`);
    let png;
    try { png = await readFile(target); } catch { /* Render only the requested page. */ }
    if (!png) {
      const { canvas } = await pdfRuntime(), page = await doc.getPage(number);
      const initial = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 1800 / Math.max(initial.width, initial.height));
      const viewport = page.getViewport({ scale });
      const image = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: image.getContext('2d'), viewport }).promise;
      png = image.toBuffer('image/png'); await writeFile(target, png, { mode: 0o600 });
      page.cleanup();
    }
    return { png, path: target, page: number, title: file.title, sourceUrl: file.sourceUrl };
  } finally { await doc.loadingTask.destroy(); }
}

export async function indexPdf(file, dir) {
  const indexPath = join(dir, 'document-v1.json'), textPath = join(dir, 'document-v1.md');
  const result = (data, indexCacheHit) => ({ ...file, ...data, pages: data.pages.slice(0, 120), pageMapTruncated: data.pages.length > 120, pageMapPath: indexPath, textPath, indexCacheHit });
  try {
    const existing = JSON.parse(await readFile(indexPath, 'utf8'));
    await readFile(textPath);
    return result(existing, true);
  } catch { /* Build one complete local text index per content hash. */ }
  const doc = await openPdf(file.path);
  try {
    if (doc.numPages > 1500) throw fail('1500쪽보다 큰 문서는 페이지 범위를 나누어 read_pdf로 읽어 주세요.');
    const pages = [], sections = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number), content = await page.getTextContent();
      const text = content.items.map(i => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join('').trim();
      await atomicJson(join(dir, `text-v1-${number}.json`), { text });
      sections.push(`## PDF page ${number}\n\n${text}`);
      pages.push({ page: number, preview: text.slice(0, 180), characters: text.length, needsVisualReview: text.length < 100 });
      page.cleanup();
    }
    const data = { totalPages: doc.numPages, pages, note: '전체 페이지의 추출 텍스트를 로컬에 저장했습니다. preview는 목차가 아닌 페이지 첫 문장입니다. 챕터는 실제 제목과 북마크를 확인해 구성하고, 이미지·수식은 렌더링하여 확인하세요.' };
    const { randomUUID } = await import('node:crypto');
    const { rename } = await import('node:fs/promises');
    const temp = `${textPath}.${randomUUID()}.part`;
    await writeFile(temp, sections.join('\n\n'), { mode: 0o600 }); await rename(temp, textPath);
    await atomicJson(indexPath, data);
    return result(data, false);
  } finally { await doc.loadingTask.destroy(); }
}
