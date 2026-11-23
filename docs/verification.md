# 0.5.0 게시판·공지·CDN 개선 검증 — 2026-11-23

- `npm run build`, `npm test`, `npm run check`: 기존 회귀 검사와 게시판/공지/CDN/배치 검사를 포함해 자동 검사 75개 통과, 실패·제외 0개. 설치 패키지 stdio에서 도구 15개 확인.
- iframe만 있는 게시글에서 videos 추출, board/announcement 전용 ID, 캐시 적중 전 최신 원문의 iframe 제거·잠금 확인, 공지 첨부의 최신 참조 검사.
- 공통 origin 목록의 학교 CDN, 전체/Range/이어받기/리다이렉트/HLS 구간의 Referer 전달 및 Authorization·Cookie 미전송 검사. 후보 실패 시 다음 검증 후보 선택과 URL·서명 값 비노출 검사.
- 파일 경로 401과 정상 게시판·LearningX·connection_status를 동시에 재현. 정상 연결에서 setupRequired를 반환하지 않고 공급 경로별 상태를 유지.
- 합성 강의 7개를 날짜별 저장하는 중 하나를 중단해 6개 성공·1개 실패로 보고한 뒤 해당 항목만 이어받음. 최종 7개 파일을 실제 파일시스템에서 stat 및 SHA-256으로 확인. 원문 날짜/게시 시각 구분, 날짜 불명확/복수 날짜, 날짜-01/-02와 동명 수정 파일 보존 검사.
- 게시판 검색의 범위 제한과 같은 페이지의 post offset 이어 조회 검사.
- Chromium에서 공지 본문+영상 표시, 수강 완료와 결석의 독립 표시, 미확인 과제 필터, 현재 화면의 fresh 새로고침 및 모바일 가로 넘침 없음을 합성 데이터로 검증.

이 버전은 사용자 제보의 실제 학교 응답·CDN·Referer 제약을 반영했다. 사용자 측 실제 영상 파일 검증과 이 세션의 합성 회귀 검증을 구분한다. 실제 학교 계정/학생 자료/서명 URL을 이 저장소의 fixture나 로그에 넣지 않았으며, 제보에 기재된 실파일은 이 세션에서 다시 읽거나 검증하지 않았다. Windows/macOS 직접 실행과 공개 GitHub CI 결과는 별도 확인 대상이다.

---

# 0.4.0 영상 다운로드 검증 — 2026-11-23

- `npm run build`, `npm test`: 자동 검사 59개 통과, 실패·제외 0개. 기존 PDF·연결·대시보드 검사 포함. 설치 패키지 stdio에서 도구 14개 확인.
- 영상 추가 검사: MP4 저장·지정 폴더·동시 요청 재사용·수정 파일 보존·권한 철회·Range/If-Range 이어받기·전체 응답으로의 안전한 재시작·잘린 파일/로그인 HTML 거절·5 GiB 한도·리다이렉트 자격 증명 경계.
- Commons 직접 URL, 서명 값, UPF 이야기 순서와 여러 영상 파일, 식별자 불일치, 메타데이터 비노출을 합성 응답으로 검사. 실제 플레이어/진도/시청 완료 API는 호출하지 않음.
- HLS: 화질 선택, 별도 기본 음성, 완료 구간 재사용, 바이트 구간 검증, 외부 호스트·암호화·실시간 목록 차단. 로컬 m3u8에는 원격 URL이나 서명 토큰을 남기지 않음.
- FFmpeg로 직접 만든 검은 화면+사인파 합성 영상을 다운로드 경로에 통과시킨 뒤 ffprobe 및 FFmpeg 전체 디코딩으로 MP4, 분리 영상·음성 MPEG-TS HLS, 초기화 파일이 있는 fMP4 HLS의 오프라인 영상+음성 재생을 확인. FFmpeg는 검증에만 사용하며 사용자 런타임 의존성이 아님.

실제 고려대 계정·영상 원본·CDN 응답은 이 세션에서 검증하지 않았다. 공개 프로젝트는 Commons XML 필드 구조 조사에만 참고했으며, 해당 프로젝트의 결과를 이 플러그인의 실계정 검증으로 간주하지 않는다. 실제 학교 데이터나 토큰을 fixture·로그·저장소에 포함하지 않았다. Windows/macOS 실사용 및 GitHub CI 결과는 별도 확인 대상이다.

---

# 0.3.0 검증 — 2026-11-23

현재 클라우드 인스턴스: Linux, Node.js 24.22.3, npm 11.19.1.

- `npm ci` 반복 설치, `npm run build`, `npm run check`, `npm test` 통과. 자동 테스트 **39개 통과, 실패·취소·제외 0개**.
- `npm audit --omit=dev`: 알려진 취약점 0개. PDF.js 6.5.438, @napi-rs/canvas 1.2.0 및 Hono 전이 의존성 보안 패치 반영.
- 실제 Chromium에서 이전 no-referrer 정책의 폼 POST가 `Origin: null`을 보내 Forbidden이 되는 현상을 재현. 수정 후 일반 Origin과 null Origin 모두 합성 토큰 검증·로컬 저장 성공. 다른 Origin과 잘못된 CSRF 검증값은 계속 차단. 응답 HTML에 입력 토큰 미포함.
- 데스크톱 1280/1440px 및 모바일 390px에서 연결 화면·대시보드 확인. 브라우저 오류 없음, 가로 넘침 없음. 토큰 보기/숨기기, 과목 조회, 공지, 제출 상태 필터, 목록 검색, 게시판 → 글 → 본문, 주차학습 동작 확인. 데이터는 모두 합성 자료.
- 과제 상태 필터는 전체 항목에 적용한 뒤 페이지 분할. 미확인·면제·온라인 제출 대상 아님 보존. 과제 본문의 학교 파일 링크 추출과 숨김 첨부의 원문 재검증·접근 철회 차단 검사.
- 지정 폴더 PDF 내보내기: 실제 사본 생성, 동일 파일 재사용, 기존 필기 보존, 권한 철회 후 내보내기 차단 검사.
- 독립 복사한 Codex·Claude·legacy 패키지가 개발 clone·node_modules 없이 실행. 실제 stdio 연결에서 도구 13개 및 연결 화면 HTTP 응답 확인. 합성 PDF 전체 추출·PNG 렌더링 성공.
- 클라우드용 install_script 재실행, start_skill의 경로·환경변수로 패키지 실행 검증. 서비스 프로세스가 다음 환경에 유지된다고 가정하지 않음.

실학교 토큰·학교 데이터는 사용하지 않았다. 실제 계정의 과목별 차이, Codex/Claude 모델의 자연어 대화, 이번 변경의 Windows/macOS 직접 실행, 공개 디렉터리 승인 및 모든 사용자 환경은 이 결과로 검증되지 않는다. 로컬 빌드·커밋과 GitHub 배포는 별도 단계다.

---

# 검증 기록 — 2026-10-24

## 0.2.0 — 첫 사용 설정과 바탕화면 보관

- `npm run build`, `npm test` 32개, `npm run check`, `npm audit --omit=dev` 통과(알려진 취약점 0).
- GitHub Actions [40099971686](https://github.com/iamnotfemale/canvas-lms-for-agents/actions/runs/40099971686): 코드 커밋 `c919423`에서 Ubuntu·Windows 모두 깨끗한 설치, 번들 재생성과 일치 검사, 패키지 검사, 32개 테스트 통과.
- 개발 clone/node_modules/설정이 없는 별도 복사 패키지의 stdio 시작, 도구 11개 및 로컬 설정 화면 응답 검증.
- 합성 토큰으로 Origin 차단, 학교 검증 실패 시 기존 설정 보존, 토큰 HTML 미반영, 같은 MCP 세션 연결 재개, 만료 토큰 교체 검증.
- Windows 실계정: 개발 clone 밖에 복사한 설치 번들에서 PDF 엔진을 자동 설치하고 실제 PDF 읽기·PNG 렌더링 성공. 시작부터 각각 약 8.8초·9.5초(한 번의 cold 측정, 네트워크 환경에 따라 다름).
- 실제 기존 PDF 3개를 재다운로드 없이 바탕화면 학기/과목/실제파일명으로 보관. 자동 테스트에서 동시 요청, 파일명 충돌, 사용자 수정본 보존, 캐시 삭제 후 보관본 복원을 검증.
- 사용자 Codex에 0.2.0 설치 완료. 실제 설치 폴더의 manifest를 공식 SDK로 실행하여 11개 도구·연결·수강목록 조회 성공. SDK 검증은 호스트의 경로 placeholder를 검사 스크립트가 치환한다.
- 읽을 수 있는 게시글의 첨부를 파일 목록의 hidden_for_user와 혼동하던 버그 수정. fresh 게시글에서 첨부 존재를 재확인하며 locked/locked_for_user/read=false 및 삭제된 첨부는 계속 차단한다.
- Codex 실제 app-server의 `mcpServerStatus/list`에서도 0.2.0 서버와 11개 도구 발견, toolsError=null 확인. 현재 Codex가 PLUGIN_ROOT를 치환하지 않는 경우를 위한 설치 캐시 경로 fallback을 추가했고, 양쪽 manifest 및 legacy fallback을 독립 복사 패키지로 테스트했다.
- 아래 0.1.0 기록은 이전 검증이다. 0.2.0의 @ 메뉴/설정 버튼 직접 UI 조작과 macOS 실사용은 미검증이다.

## 0.1.0 이전 검증

환경: Windows, Node 24.15.0. 합성 테스트와 실계정 검증을 구분한다. 토큰·과목명·사용자 ID·학교 원문·실제 파일은 공개 저장소에 포함하지 않았다.

## 자동 검사

- `npm test`: 22개 통과, 실패·제외 없음.
- `npm run check`: JavaScript 문법, 플러그인 버전·manifest 경로·JSON·스킬 frontmatter 검사 통과.
- Skill Creator `quick_validate.py`: 통과.
- `claude plugin validate plugin/.claude-plugin/plugin.json`: manifest 오류/경고 0. 공개 디렉터리 제출용 아이콘은 미포함이며 별도 디렉터리 진단에는 비차단 아이콘 경고가 있다.
- `npm audit --omit=dev`: 알려진 취약점 0개. 이 결과가 취약점이 없다는 보증은 아니다.
- GitHub Actions [run 40094249559](https://github.com/iamnotfemale/canvas-lms-for-agents/actions/runs/40094249559): 코드 커밋 `deedb59`에서 Ubuntu·Windows 각각 깨끗한 `npm ci`, 패키지 검사, 22개 테스트 모두 통과.

회귀 범위: 동일 자료 동시 다운로드 및 프로세스 간 잠금, 죽은 프로세스 잠금 복구, 캐시 재시작 재사용, 계정 격리, 내용 해시 중복 제거, 원본 변경·손상 복구, 권한 취소 차단, 불완전/HTML 다운로드 제거, 조건부 304, 용량 정리, 오래된 임시파일 정리, 페이지네이션·루프 차단, 파일 API 제한 시 모듈 검색, 과목 모호성, 주차/장/자료번호 구분, LTI 자격 증명 경계, 저장소 리다이렉트 차단, 목록 실패/동시 요청, 긴 공지 상세 읽기, 전체 PDF 추출·실제 PNG 렌더링, SDK MCP 도구 호출·입력 검증, 실제 stdio 실행, 설치 manifest의 작업 폴더 독립성.

## 고려대 실계정 — 조회 전용

수강 9과목 조회 성공. 첫 4과목 중 PDF가 있는 표본 과목 하나에서 검증했다.

| 작업 | 결과 | 경과 시간 |
|---|---|---:|
| 자료 검색 | 20개, files API 제한은 warnings로 표시하고 모듈/LearningX 성공 | 별도 계측 안 함 |
| 공지 | 2개 조회 | 137 ms |
| 과제 | 5개 조회 | 251 ms |
| 출석 | 32개 항목 조회 | 488 ms |
| 주차학습 | 20개 항목 조회 | 229 ms |
| 게시판 | 2개 조회 | 440 ms |
| PDF 최초 다운로드 | 원본 1,790,303 bytes, 21쪽 | 872 ms |
| PDF 재요청 | cacheHit=true | 448 ms |
| 전체 텍스트 최초 추출 | 21쪽 로컬 저장 | 1,500 ms |
| 전체 텍스트 재요청 | indexCacheHit=true | 441 ms |
| 첫 페이지 읽기 | 텍스트 추출 성공 | 483 ms |
| 첫 페이지 렌더링 | PNG 55,359 bytes | 782 ms |

표본 1개의 당시 측정이며 평균·최악 지연이나 모든 과목의 성공을 보장하지 않는다. 재사용 요청의 시간에는 현재 학교 접근권을 확인하는 API 호출이 포함된다. 출결 “조회 성공”은 모든 출결 판정이 정확하다는 별도 보증이 아니다.

## 설치

- Codex CLI `0.164.0-alpha.11.1`: 로컬 marketplace add → plugin add → enabled=true 확인.
- Codex가 복사한 실제 plugin 패키지의 MCP manifest로 공식 MCP SDK stdio 연결: 도구 10개, 연결 성공, 수강 9과목 조회.
- Claude Code `2.1.309`: 별도 설정 디렉터리에서 marketplace add/install 성공. 양쪽이 사용하는 동일 MCP manifest의 실행을 검증했다.
- 0.1.0은 의존성을 개발 clone에 유지했다. 0.2.0은 기본 런타임 번들과 첫 분석 시 PDF 엔진 자동 설치로 대체했다. 설치되는 `plugin/`에 토큰·캐시·학교 자료를 포함하지 않는다.

## 아직 검증하지 않은 범위

- Codex 재시작 후 @ 선택 메뉴의 직접 UI 조작, Claude Code 실제 모델과의 전체 챕터 튜터링 대화.
- Gmail 외부 발송 및 계정별 첨부 지원. 실제 메일을 보내지 않았다.
- 모든 고려대 과목·다른 학교·학기 변경·학교 인증 정책 변경.
- 수백 쪽 스캔 PDF 전체 분석과 전체 OCR. 이미지 페이지는 필요할 때 시각적으로 분석한다.
- macOS 실사용. Linux/Windows의 합성 CI 결과는 GitHub Actions에서 별도 확인한다.

로컬 테스트 성공을 공개 디렉터리 승인, 학교 승인, OAuth 다중 사용자 배포 준비로 표현하지 않는다.
