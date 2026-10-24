import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { Canvas } from './canvas.js';
import { FileCache } from './cache.js';
import { readPdf, renderPage, indexPdf } from './pdf.js';
import { errorInfo, fail } from './util.js';
import { beginSetup } from './onboarding.js';

const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export function createServer({ service, clientFactory = config => new Canvas(config.token, { aliases: config.aliases }) } = {}) {
  const server = new McpServer({ name: 'canvas-lms-for-agents', version: '0.2.0' });
  let active = service;
  async function services() {
    if (!active) {
      let config;
      try { config = await loadConfig(); } catch (e) { if (e.code === 'SETUP_REQUIRED') throw e; throw fail(e.message); }
      const client = clientFactory(config);
      let account;
      try { account = await client.identity(); } catch (e) { if (e.status === 401) e.code = 'SETUP_REQUIRED'; throw e; }
      active = { client, cache: new FileCache(config.cacheDir, account, config.maxBytes, config.libraryDir) };
      await active.cache.init();
    }
    return active;
  }
  function tool(name, description, inputSchema, handler, localWrite = false) {
    server.registerTool(name, {
      description, inputSchema,
      annotations: { readOnlyHint: !localWrite, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async args => {
      try { return await handler(args, await services()); }
      catch (e) {
        if (e.code === 'SETUP_REQUIRED') return text(await beginSetup(process.env.CANVAS_AGENT_NO_BROWSER !== '1'));
        return { isError: true, ...text(errorInfo(e)) };
      }
    });
  }
  const course = z.string().min(1).max(200).describe('수강 과목 ID 또는 정식 이름/설정한 약칭. 모호하면 list_courses로 선택.');
  const resource = z.string().regex(/^(file|lx):\d{1,30}:\d{1,30}$/).describe('find_materials가 반환한 resourceId. URL이나 로컬 경로를 입력하지 마세요.');
  const fresh = z.boolean().optional().describe('true면 목록 캐시를 건너뛰고 갱신.');
  server.registerTool('setup_connection', { description:'최초 연결 또는 만료된 토큰 교체를 위해 로컬 브라우저 입력 화면을 엽니다. 토큰을 도구 인수나 채팅에 입력하지 마세요.', inputSchema:{}, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false } }, async () => {
    active = undefined;
    return text(await beginSetup(process.env.CANVAS_AGENT_NO_BROWSER !== '1'));
  });
  tool('connection_status', '고려대 Canvas 토큰 연결과 캐시 상태를 진단합니다. 토큰이나 개인정보는 반환하지 않습니다.', {}, async (_, { client, cache }) => {
    try { await client.identity(true); }
    catch (e) { if (e.status === 401) { active = undefined; e.code = 'SETUP_REQUIRED'; } throw e; }
    return text({ connected: true, school: '고려대학교', timezone: 'Asia/Seoul', cache: await cache.stats() });
  });
  tool('list_courses', '수강 과목 목록에서 한국어 이름·약칭 후보를 찾습니다. 인지 등 모호한 약칭은 실제 목록으로 확인하세요.', { query: z.string().max(200).optional(), fresh }, async (a, { client }) => text({ courses: await client.courses(a.query, a.fresh) }));
  tool('find_materials', '과목 파일·모듈·LearningX를 함께 검색합니다. 3주차, 3장, PDF3은 다른 조건입니다. 실패한 자료 경로는 warnings로 반환합니다.', {
    course, query: z.string().max(200).optional(), week: z.number().int().min(1).max(100).optional(), chapter: z.number().int().min(1).max(1000).optional(),
    documentNumbers: z.array(z.number().int().min(0).max(1000)).max(20).optional(), fresh, offset: z.number().int().min(0).default(0),
  }, async ({ course, fresh, offset, ...filters }, { client }) => text(await client.materials(course, filters, fresh, offset)));
  tool('download_pdf', '요청한 PDF 전체를 로컬에 저장하고 절대 경로를 반환합니다. 계정별 내용 해시 캐시로 중복 다운로드를 방지하며 매번 LMS 권한을 확인합니다.', { resourceId: resource }, async (a, { client, cache }) => text(await cache.acquire(client, a.resourceId)), true);
  tool('index_pdf', 'PDF 전체를 내려받아 모든 페이지의 텍스트를 로컬 Markdown으로 추출합니다. 챕터별 학습 시작에 사용. 페이지별 짧은 미리보기와 전체 텍스트 경로를 반환하며 같은 내용은 재추출하지 않습니다.', { resourceId: resource }, async (a, { client, cache }) => text(await cache.withPdf(client, a.resourceId, indexPdf)), true);
  tool('read_pdf', '로컬 PDF의 1~8쪽을 읽고 북마크와 실제 PDF 페이지 번호를 반환합니다. 전체 문서 준비는 index_pdf, 그림·표·수식 확인은 render_pdf_page를 사용합니다.', {
    resourceId: resource, startPage: z.number().int().min(1).default(1), endPage: z.number().int().min(1).optional(),
  }, async (a, { client, cache }) => text(await cache.withPdf(client, a.resourceId, (file, dir) => readPdf(file, dir, a.startPage, a.endPage ?? a.startPage + 4))), true);
  tool('render_pdf_page', '로컬 PDF 한 페이지를 이미지로 렌더링하여 반환합니다. 도표·수식·스캔 PDF의 시각적 분석에 사용하세요.', {
    resourceId: resource, page: z.number().int().min(1),
  }, async (a, { client, cache }) => {
    const { png, ...info } = await cache.withPdf(client, a.resourceId, (file, dir) => renderPage(file, dir, a.page));
    return { content: [{ type: 'text', text: JSON.stringify(info) }, { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  }, true);
  tool('course_info', '공지 요약·과제/퀴즈 제출 상태·출결·주차학습·강의계획·일정을 조회합니다. 출결은 LearningX 원본 상태이며 시청이나 출석 처리는 하지 않습니다. 시간은 Asia/Seoul로 표시하세요.', {
    course, kind: z.enum(['announcements', 'assignments', 'attendance', 'weekly', 'syllabus', 'calendar']), fresh,
    offset: z.number().int().min(0).default(0), itemId: z.string().regex(/^\d{1,30}$/).optional().describe('목록에서 본 항목 ID. 공지·과제의 긴 본문을 자세히 읽을 때 지정.'),
  }, async (a, { client }) => text(await client.overview(a.course, a.kind, a.fresh, a.offset, a.itemId)));
  tool('read_boards', 'LearningX 게시판 목록, 글 목록 또는 글 본문·첨부 자료를 읽습니다. 공지가 Canvas 공지에 없으면 학교 게시판도 확인하세요.', {
    course, boardId: z.string().regex(/^\d{1,30}$/).optional(), postId: z.string().regex(/^\d{1,30}$/).optional(), page: z.number().int().min(1).max(10000).default(1),
  }, async (a, { client }) => text(await client.boards(a.course, a.boardId, a.postId, a.page)));
  tool('cache_status', '현재 계정의 로컬 캐시 경로·용량·자료 수·중복 제거된 PDF 수를 확인합니다.', {}, async (_, { cache }) => text(await cache.stats()));
  return server;
}
export async function start() { await createServer().connect(new StdioServerTransport()); }
