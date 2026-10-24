import { CANVAS, LEARNINGX, MEDIA, id, safeUrl, publicUrl, request, Memo, mapLimit, plain, clipped, fail, errorInfo } from './util.js';
import { lxGet, learningItem, learningPdf, attendanceLabel } from './learningx.js';

const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function numbered(title, kind) {
  const patterns = {
    week: /(?:\bweek\s*(\d+)|(?:^|\D)(\d+)\s*주차)/i,
    chapter: /(?:\b(?:chapter|ch\.?)\s*(\d+)|(?:^|\D)(\d+)\s*(?:장|단원))/i,
    document: /(?:\b(?:pdf|lecture|lec|part)\s*[_ .-]*(\d+)|(?:^|\D)(\d+)\s*강|^\s*(\d+)(?:[_.\s-]|$))/i,
  };
  const match = String(title).match(patterns[kind]);
  return match ? Number(match.slice(1).find(Boolean)) : null;
}
export function filterMaterials(items, { query = '', week, chapter, documentNumbers } = {}) {
  const q = normalize(query);
  return items.filter(item => (!q || normalize(item.title).includes(q)) &&
    (week == null || Number(item.week ?? numbered(item.module, 'week')) === week && (item.week != null || numbered(item.module, 'week') != null)) &&
    (chapter == null || numbered(item.title, 'chapter') === chapter || numbered(item.module, 'chapter') === chapter) &&
    (!documentNumbers?.length || documentNumbers.includes(numbered(item.title, 'document'))));
}
export class Canvas {
  memo = new Memo();
  linkedFiles = new Map();
  constructor(token, { fetcher = fetch, aliases = {} } = {}) { this.token = token; this.fetcher = fetcher; this.aliases = aliases; }
  async get(path, ttl = 60000, fresh = false) {
    return this.memo.get(path, ttl, async () => {
      let url = new URL('/api/v1' + path, CANVAS); url.searchParams.set('per_page', '100');
      const seen = new Set(), values = [];
      while (url) {
        safeUrl(url.href, [CANVAS], '/api/v1/');
        if (seen.has(url.href) || seen.size >= 100) throw fail('학교 목록 페이지 한도를 초과했습니다.');
        seen.add(url.href);
        const res = await request(this.fetcher, url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' } });
        const data = await res.json();
        if (!Array.isArray(data)) return data;
        values.push(...data);
        const next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? new URL(next[1], CANVAS) : null;
      }
      return values;
    }, fresh);
  }
  async identity(fresh = false) { const me = await this.get('/users/self', 60000, fresh); return id(me.id); }
  async courses(query = '', fresh = false) {
    const values = await this.get('/courses?enrollment_state=active&include[]=term&include[]=teachers', 120000, fresh);
    const mapped = values.filter(c => c.name && !c.access_restricted_by_date).map(c => ({
      id: id(c.id), name: c.name, code: c.course_code, term: c.term?.name,
      teachers: c.teachers?.map(t => t.display_name), url: `${CANVAS}/courses/${c.id}`,
    }));
    if (!query) return mapped;
    const alias = this.aliases[query];
    const q = normalize(alias || query);
    return mapped.filter(c => c.id === String(alias || query) || normalize(c.name).includes(q) || normalize(c.code).includes(q));
  }
  async course(query, fresh = false) {
    const matches = await this.courses(query, fresh);
    if (matches.length !== 1) throw fail(matches.length ? `과목이 여러 개입니다. 과목 ID로 선택하세요: ${matches.map(c => `${c.id} ${c.name}`).join(', ')}` : '수강 과목을 찾지 못했습니다. 과목 목록에서 정식 이름이나 ID를 확인하세요.');
    return matches[0];
  }
  async weekly(course, fresh = false) {
    const modules = await lxGet(this, course, 'weekly', 'modules?include_detail=true', fresh);
    if (!Array.isArray(modules)) throw fail('주차학습 응답 형식이 달라졌습니다.');
    return modules.filter(m => m.published !== false).flatMap(m => (m.module_items || []).filter(i => i.published !== false).map(i => learningItem(i, course, m)));
  }
  async materials(courseQuery, filters = {}, fresh = false, offset = 0) {
    const course = await this.course(courseQuery);
    const cid = course.id;
    const [files, modules, weekly] = await Promise.allSettled([
      this.get(`/courses/${cid}/files`, 120000, fresh),
      this.get(`/courses/${cid}/modules`, 120000, fresh).then(ms => mapLimit(ms, 3, async m => {
        const items = await this.get(`/courses/${cid}/modules/${id(m.id)}/items`, 120000, fresh);
        return items.filter(i => i.type === 'File').map(i => ({ resourceId: `file:${cid}:${id(i.content_id)}`, courseId: cid, title: i.title, module: m.name, week: numbered(m.name, 'week'), pdf: /\.pdf$/i.test(i.title), url: publicUrl(i.html_url) }));
      })).then(ms => ms.flat()),
      this.weekly(cid, fresh),
    ]);
    const warnings = [files, modules, weekly].flatMap((r, i) => r.status === 'rejected' ? [{ source: ['files', 'modules', 'learningx'][i], ...errorInfo(r.reason) }] : []);
    const found = new Map();
    if (files.status === 'fulfilled') for (const f of files.value) found.set(`file:${cid}:${id(f.id)}`, {
      resourceId: `file:${cid}:${f.id}`, courseId: cid, title: f.display_name || f.filename,
      pdf: f['content-type'] === 'application/pdf' || /\.pdf$/i.test(f.filename), locked: !!(f.locked_for_user || f.hidden_for_user),
      url: `${CANVAS}/courses/${cid}/files/${f.id}`,
    });
    if (modules.status === 'fulfilled') for (const f of modules.value) found.set(f.resourceId, { ...found.get(f.resourceId), ...f });
    if (weekly.status === 'fulfilled') for (const f of weekly.value) {
      if (f.resourceId.startsWith('file:') || f.pdf || f.video) found.set(f.resourceId, { ...found.get(f.resourceId), ...f, viewer: undefined });
    }
    const results = filterMaterials([...found.values()], filters);
    return { course, items: results.slice(offset, offset + 100), total: results.length, nextOffset: offset + 100 < results.length ? offset + 100 : null, warnings, checkedAt: new Date().toISOString() };
  }
  async resolve(resourceId) {
    const match = /^(file|lx):(\d{1,30}):(\d{1,30})$/.exec(resourceId);
    if (!match) throw fail('자료 검색에서 받은 resourceId를 사용하세요.');
    const [, kind, course, resource] = match;
    await this.identity(true);
    const courseInfo = await this.course(course, true);
    const location = { term: courseInfo.term, courseName: courseInfo.name };
    if (kind === 'lx') {
      const item = (await this.weekly(course, true)).find(i => i.itemId === resource);
      if (!item || item.locked) throw fail('현재 열람할 수 없는 주차학습 자료입니다.', 403);
      return { ...await learningPdf(this, item), ...location, resourceId, sourceUrl: item.url };
    }
    const file = await this.get(`/courses/${course}/files/${resource}`, 0, true);
    if (file.locked_for_user || file.locked || file.permissions?.read === false) throw fail('학교에서 잠긴 자료입니다.', 403);
    if (file.hidden_for_user) {
      const link = this.linkedFiles.get(resourceId);
      if (!link) throw fail('게시판 글의 첨부 목록을 먼저 조회해 자료 접근 경로를 확인하세요.', 403);
      // Hidden means link-only; verify the original readable post again, never bypass a lock.
      const post = await lxGet(this, course, 'boards', `boards/${link.boardId}/posts/${link.postId}`, true);
      if (!(post.attachments || []).some(a => String(a.canvas_file_id) === resource)) throw fail('게시판에서 이 첨부 자료를 더 이상 확인할 수 없습니다.', 403);
    }
    if (!(file['content-type'] === 'application/pdf' || /\.pdf$/i.test(file.filename || file.display_name))) throw fail('현재 다운로드·학습은 PDF 자료를 지원합니다.');
    safeUrl(file.url, [CANVAS, LEARNINGX, 'https://kr.object.gov-ncloudstorage.com']);
    return { ...location, resourceId, url: file.url, version: file.updated_at ? `${file.updated_at}:${file.size ?? ''}` : null, title: file.display_name || file.filename, sourceUrl: `${CANVAS}/courses/${course}/files/${resource}` };
  }
  async openDownload(source, headers = {}) {
    let url = source.url;
    for (let i = 0; i < 5; i++) {
      safeUrl(url, [CANVAS, LEARNINGX, MEDIA, 'https://kr.object.gov-ncloudstorage.com']);
      // Signed storage URLs do not receive the Canvas PAT, even on redirects.
      const res = await request(this.fetcher, url, { headers }, { redirects: true });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const next = res.headers.get('location'); await res.body?.cancel();
        if (!next) throw fail('파일 이동 주소가 없습니다.');
        url = new URL(next, url).href;
      } else return res;
    }
    throw fail('파일 이동 횟수를 초과했습니다.');
  }
  async overview(courseQuery, kind, fresh = false, offset = 0, itemId) {
    const course = await this.course(courseQuery), cid = course.id;
    let items;
    if (kind === 'announcements') {
      const rows = await this.get(`/courses/${cid}/discussion_topics?only_announcements=true`, 60000, fresh);
      items = rows.map(a => ({ id: String(a.id), title: a.title, postedAt: a.posted_at, ...clipped(plain(a.message), itemId ? 30000 : 1800), url: publicUrl(a.html_url) }));
    } else if (kind === 'assignments') {
      const rows = await this.get(`/courses/${cid}/assignments?include[]=submission`, 60000, fresh);
      let submissions = [], submissionWarning;
      if (rows.some(a => !a.submission)) {
        try { submissions = await this.get(`/courses/${cid}/students/submissions?student_ids[]=self`, 60000, fresh); }
        catch (e) { submissionWarning = errorInfo(e); }
      }
      items = rows.map(a => {
        const s = a.submission || submissions.find(s => String(s.assignment_id) === String(a.id));
        return { id: String(a.id), title: a.name, ...clipped(plain(a.description), itemId ? 30000 : 1800), dueAt: a.due_at, unlockAt: a.unlock_at, lockAt: a.lock_at,
          status: !s ? '확인 불가' : s.excused ? '면제' : s.submitted_at || ['submitted', 'graded', 'pending_review'].includes(s.workflow_state) ? '제출/채점 완료' : '미제출',
          score: s?.score ?? null, points: a.points_possible, quiz: !!a.is_quiz_assignment, url: publicUrl(a.html_url), submissionWarning: !s ? submissionWarning : undefined };
      });
    } else if (kind === 'attendance') {
      const [value, summary] = await Promise.all([lxGet(this, cid, 'attendance', 'attendance_items?include_detail=true&sort_by=created_at', fresh), lxGet(this, cid, 'attendance', 'attendance_items/summary', fresh)]);
      items = (value.attendance_items || []).filter(i => i.published !== false).map(i => ({
        id: String(i.item_id), title: i.title, week: i.week_position, dueAt: i.due_at, unlockAt: i.unlock_at,
        status: attendanceLabel(summary.attendance_summaries?.[i.item_id]?.attendance_status, i.use_attendance),
        useAttendance: i.use_attendance === true, url: `${CANVAS}/courses/${cid}`,
      }));
    } else if (kind === 'weekly') {
      items = (await this.weekly(cid, fresh)).map(({ viewer, ...item }) => item);
    } else if (kind === 'syllabus') {
      const value = await this.get(`/courses/${cid}?include[]=syllabus_body`, 120000, fresh);
      items = [{ ...clipped(plain(value.syllabus_body), 30000), url: `${CANVAS}/courses/${cid}/assignments/syllabus` }];
    } else if (kind === 'calendar') {
      const rows = await this.get(`/calendar_events?context_codes[]=course_${cid}&all_events=true`, 60000, fresh);
      items = rows.map(r => ({ id: String(r.id), title: r.title, startAt: r.start_at, endAt: r.end_at, ...clipped(plain(r.description)), url: publicUrl(r.html_url) }));
    } else throw fail('지원하지 않는 조회 종류입니다.');
    if (itemId) items = items.filter(i => String(i.id ?? i.itemId) === itemId);
    return { course, kind, items: items.slice(offset, offset + 20), total: items.length, nextOffset: offset + 20 < items.length ? offset + 20 : null, timezone: 'Asia/Seoul', checkedAt: new Date().toISOString() };
  }
  async boards(courseQuery, boardId, postId, page = 1) {
    const course = await this.course(courseQuery), cid = course.id;
    if (postId && !boardId) throw fail('게시판 ID를 먼저 선택하세요.');
    let path = 'boards';
    if (boardId) path += `/${id(boardId)}/posts`;
    if (postId) path += `/${id(postId)}`;
    else if (boardId) path += `?page=${page}`;
    const value = await lxGet(this, cid, 'boards', path);
    if (!boardId) return { course, boards: value.map(b => ({ id: String(b.id), title: b.title })) };
    if (!postId) return { course, posts: (value.items || []).map(p => ({ id: String(p.id), title: p.title, postedAt: p.created_at, attachmentCount: p.attachment_count })), pagination: value.pagination };
    const attachments = (value.attachments || []).filter(a => /^\d+$/.test(String(a.canvas_file_id))).map(a => ({ resourceId: `file:${cid}:${a.canvas_file_id}`, title: a.filename }));
    for (const attachment of attachments) this.linkedFiles.set(attachment.resourceId, { boardId, postId });
    return { course, title: value.title, ...clipped(plain(value.content), 30000), postedAt: value.created_at, url: `${CANVAS}/courses/${cid}`, attachments };
  }
}
