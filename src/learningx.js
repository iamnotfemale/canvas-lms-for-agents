import { Parser } from 'htmlparser2';
import { CANVAS, LEARNINGX, MEDIA, id, safeUrl, request, fail, plain } from './util.js';

const kinds = {
  weekly: [/^(주차학습|강의\s*콘텐츠|Weekly Learning)$/i, '/learningx/lti/modulebuilder'],
  attendance: [/^(출결현황|출결\s*\/\s*학습현황|Attendance)$/i, '/learningx/lti/lecture_attendance/course_menu'],
  boards: [/^(게시판|Boards?)$/i, '/learningx/lti/learningx_board/boards'],
};
export function parseLaunch(html, kind) {
  let inside = false, action;
  const fields = new URLSearchParams();
  new Parser({
    onopentag(tag, attrs) {
      if (tag === 'form') { inside = attrs.action === LEARNINGX + kinds[kind][1]; if (inside) action = attrs.action; }
      if (inside && tag === 'input' && attrs.name) fields.set(attrs.name, attrs.value || '');
    },
    onclosetag(tag) { if (tag === 'form') inside = false; },
  }).end(html);
  if (!action || !fields.get('oauth_signature')) throw fail('LearningX 인증 양식을 확인할 수 없습니다.');
  return { action, fields };
}
export async function session(client, course, kind, fresh = false) {
  id(course);
  return client.memo.get(`session:${course}:${kind}`, 240000, async () => {
    const tabs = await client.get(`/courses/${course}/tabs`, 120000, fresh);
    const tool = tabs.find(t => kinds[kind][0].test(t.label));
    const toolId = tool?.id?.match(/^context_external_tool_(\d+)$/)?.[1];
    if (!toolId) throw fail('이 과목에 해당 LearningX 메뉴가 없습니다.', 404);
    const launch = await client.get(`/courses/${course}/external_tools/sessionless_launch?id=${toolId}&launch_type=course_navigation`, 0, true);
    const jar = new Map();
    async function follow(url, origin, options = {}) {
      for (let i = 0; i < 6; i++) {
        safeUrl(url, [origin]);
        const res = await request(client.fetcher, url, { ...options, headers: {
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        } }, { retries: 0, redirects: true });
        for (const cookie of res.headers.getSetCookie()) {
          const pair = cookie.split(';')[0], at = pair.indexOf('=');
          if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1));
        }
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location'); await res.body?.cancel();
          if (!location) throw fail('학교 로그인 이동 주소가 없습니다.');
          url = new URL(location, url).href;
          if (![307, 308].includes(res.status)) options = {};
        } else return res.text();
      }
      throw fail('학교 로그인 이동 횟수를 초과했습니다.');
    }
    const form = parseLaunch(await follow(launch.url, CANVAS), kind);
    jar.clear(); // Canvas credentials and cookies never cross into LearningX.
    await follow(form.action, LEARNINGX, { method: 'POST', body: form.fields });
    if (!jar.get('xn_api_token')) throw fail('LearningX 인증을 완료하지 못했습니다.');
    return jar;
  }, fresh);
}
export async function lxGet(client, course, kind, suffix, fresh = false) {
  const path = kind === 'boards' ? `/learningx/api/v1/learningx_board/courses/${id(course)}/${suffix}` : `/learningx/api/v1/courses/${id(course)}/${suffix}`;
  return client.memo.get(`lx:${path}`, 60000, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const jar = await session(client, course, kind, attempt > 0);
      try {
        const response = await request(client.fetcher, LEARNINGX + path, { headers: {
          Authorization: `Bearer ${decodeURIComponent(jar.get('xn_api_token'))}`,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), Accept: 'application/json',
        } });
        return await response.json();
      } catch (e) { if (attempt === 0 && [401, 403].includes(e.status)) continue; throw e; }
    }
  }, fresh);
}
export const attendanceLabel = (status, enabled) => enabled === false ? '출결 대상 아님' : ({ attendance: '출석', late: '지각', absent: '결석', excused: '공결', none: '미처리' }[status] || '확인 불가');
export function learningItem(raw, course, module) {
  const data = raw.content_data || {}, media = data.item_content_data || {};
  return {
    resourceId: raw.content_type === 'attachment' ? `file:${course}:${id(raw.content_id)}` : `lx:${course}:${id(raw.module_item_id)}`,
    courseId: course, itemId: String(raw.module_item_id), title: raw.title || media.file_name || '제목 없음',
    module: module.title, week: module.week_position ?? null,
    pdf: media.content_type === 'pdf' || /\.pdf$/i.test(media.file_name || raw.title || ''),
    video: ['mp4', 'readystream', 'video', 'screen', 'youtube'].includes(media.content_type),
    locked: raw.published === false || data.published === false || data.opened === false || data.locked_for_user === true,
    dueAt: data.due_at || null, unlockAt: data.unlock_at || null,
    completed: raw.completion_determinable && typeof raw.completed === 'boolean' ? raw.completed : null,
    attendance: attendanceLabel(raw.attendance_status, data.use_attendance), useAttendance: data.use_attendance === true,
    description: plain(data.description || ''), viewer: media.view_url,
    url: `${CANVAS}/courses/${course}/modules/items/${raw.module_item_id}`,
  };
}
export async function learningPdf(client, item) {
  if (item.locked || !item.pdf) throw fail('열람 가능한 PDF가 아닙니다.', 403);
  const viewer = safeUrl(item.viewer, [MEDIA]);
  const contentId = viewer.pathname.match(/^\/em\/([a-zA-Z0-9]+)\/?$/)?.[1];
  if (!contentId) throw fail('지원하지 않는 학교 PDF 뷰어입니다.');
  const res = await request(client.fetcher, `${MEDIA}/viewer/ssplayer/uniplayer_support/content.php?content_id=${contentId}`);
  let tag = '', uri = '';
  new Parser({ onopentag(name) { tag = name; }, ontext(t) { if (tag === 'content_uri') uri += t; }, onclosetag() { tag = ''; } }, { xmlMode: true }).end(await res.text());
  const source = safeUrl(uri.trim(), [MEDIA]);
  if (source.search || !new RegExp(`^/contents[0-9]*/[a-zA-Z0-9_-]+/${contentId}/contents/web_files/?$`).test(source.pathname)) throw fail('학교 PDF 원본 주소를 확인할 수 없습니다.');
  return { url: source.href.replace(/\/$/, '') + '/original.pdf', version: null, title: item.title };
}
