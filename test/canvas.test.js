import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Canvas, filterMaterials } from '../src/canvas.js';
import { CANVAS, LEARNINGX, MEDIA, Memo } from '../src/util.js';
import { parseLaunch, session, attendanceLabel } from '../src/learningx.js';
import { jsonResponse } from './fixtures.js';

test('pagination never forwards credentials outside Canvas', async () => {
  let calls = 0;
  const client = new Canvas('synthetic-token', { fetcher: async (url, options) => {
    calls++; assert.equal(new URL(url).origin, CANVAS); assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return jsonResponse([{ id: 1 }], 200, { link: '<https://evil.example/api/v1/courses>; rel="next"' });
  } });
  await assert.rejects(client.get('/courses'), /허용/); assert.equal(calls, 1);
});
test('pagination gathers every page, repeated page loops fail', async () => {
  let calls = 0;
  const client = new Canvas('fake', { fetcher: async () => ++calls === 1 ? jsonResponse([1], 200, { link: `<${CANVAS}/api/v1/courses?page=2>; rel="next"` }) : jsonResponse([2]) });
  assert.deepEqual(await client.get('/courses'), [1, 2]);
  const loop = new Canvas('fake', { fetcher: async () => jsonResponse([], 200, { link: `<${CANVAS}/api/v1/courses?per_page=100>; rel="next"` }) });
  await assert.rejects(loop.get('/courses'), /한도/);
});
test('course aliases resolve but ambiguous names do not silently select', async () => {
  const client = new Canvas('fake', { aliases: { 인지: '2' }, fetcher: async () => jsonResponse([{ id: 1, name: '인지과학 01' }, { id: 2, name: '인지과학 02' }]) });
  assert.equal((await client.course('인지')).id, '2');
  await assert.rejects(client.course('인지과학'), /여러 개/);
});
test('week, chapter and file numbers are independent; 5 never matches 15', () => {
  const rows = [{ title: 'Chapter 5.pdf', module: '3주차', week: 3 }, { title: 'Chapter 15.pdf', module: '5주차' }, { title: 'Lecture_05.pdf', module: '7주차' }, { title: '03_Cognition.pdf', module: 'Week 4' }];
  assert.deepEqual(filterMaterials(rows, { chapter: 5 }), [rows[0]]);
  assert.deepEqual(filterMaterials(rows, { week: 5 }), [rows[1]]);
  assert.deepEqual(filterMaterials(rows, { documentNumbers: [3, 5] }), [rows[2], rows[3]]);
  assert.deepEqual(filterMaterials(rows, { week: 5, chapter: 5 }), []);
});
test('file listing denied still returns module PDFs and warning', async () => {
  const client = new Canvas('fake', { fetcher: async url => {
    const p = new URL(url).pathname;
    if (p === '/api/v1/courses') return jsonResponse([{ id: 1, name: '인지' }]);
    if (p.endsWith('/files')) return jsonResponse({}, 401);
    if (p.endsWith('/modules')) return jsonResponse([{ id: 2, name: '5주차' }]);
    if (p.endsWith('/items')) return jsonResponse([{ type: 'File', content_id: 3, title: 'Lecture_05.pdf' }]);
    if (p.endsWith('/tabs')) return jsonResponse([]);
    throw Error('Unexpected request');
  } });
  const result = await client.materials('인지', { week: 5 });
  assert.equal(result.items[0].resourceId, 'file:1:3'); assert.equal(result.warnings.length, 2);
});
test('unknown attendance is not absence; explicit disabled attendance differs', () => {
  assert.equal(attendanceLabel(undefined, true), '확인 불가');
  assert.equal(attendanceLabel('absent', true), '결석');
  assert.equal(attendanceLabel('none', false), '출결 대상 아님');
});
test('LTI uses only selected form; Canvas PAT and cookies do not cross origins', async () => {
  const form = `<form action="${LEARNINGX}/learningx/lti/modulebuilder"><input name="oauth_signature" value="signed"></form>`;
  assert.equal(parseLaunch(form, 'weekly').fields.get('oauth_signature'), 'signed');
  assert.throws(() => parseLaunch(form.replace(LEARNINGX, 'https://evil.example'), 'weekly'));
  const client = new Canvas('SECRET-PAT', { fetcher: async (url, options) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/tabs')) return jsonResponse([{ id: 'context_external_tool_9', label: '주차학습' }]);
    if (u.pathname.endsWith('/sessionless_launch')) return jsonResponse({ url: CANVAS + '/launch' });
    if (u.pathname === '/launch') { assert.equal(options.headers.Authorization, undefined); return new Response(form, { headers: { 'set-cookie': 'canvas_session=private; Path=/' } }); }
    if (u.origin === LEARNINGX) {
      assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, ''); assert.equal(options.method, 'POST');
      return new Response('ok', { headers: { 'set-cookie': 'xn_api_token=school-token; Path=/' } });
    }
    throw Error('Unexpected request');
  } });
  assert.equal((await session(client, '1', 'weekly')).get('xn_api_token'), 'school-token');
});
test('storage redirects are allowlisted and never receive PAT', async () => {
  let calls = 0;
  const client = new Canvas('SECRET', { fetcher: async (_, opts) => { calls++; assert.equal(opts.headers.Authorization, undefined); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } });
  await assert.rejects(client.openDownload({ url: MEDIA + '/original.pdf' }), /허용/); assert.equal(calls, 1);
});
test('failed memo read is not cached as empty success; inflight reads deduplicate', async () => {
  const memo = new Memo(); let calls = 0;
  const read = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return [1]; };
  await Promise.all([memo.get('a', 1000, read), memo.get('a', 1000, read)]); assert.equal(calls, 1);
  await assert.rejects(memo.get('b', 1000, async () => { throw Error('failed'); }));
  assert.deepEqual(await memo.get('b', 1000, async () => [2]), [2]);
});

test('announcements paginate and detailed reads expose a complete long body', async () => {
  const client = new Canvas('fake', { fetcher: async url => new URL(url).pathname === '/api/v1/courses'
    ? jsonResponse([{ id: 1, name: '인지' }])
    : jsonResponse(Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Notice ${i + 1}`, message: 'A'.repeat(2200) }))) });
  const first = await client.overview('1', 'announcements');
  assert.equal(first.items.length, 20); assert.equal(first.nextOffset, 20); assert.equal(first.items[0].truncated, true);
  const second = await client.overview('1', 'announcements', false, first.nextOffset);
  assert.equal(second.items.length, 5); assert.equal(second.nextOffset, null);
  const detail = await client.overview('1', 'announcements', false, 0, '1');
  assert.equal(detail.items.length, 1); assert.equal(detail.items[0].text.length, 2200); assert.equal(detail.items[0].truncated, false);
});
