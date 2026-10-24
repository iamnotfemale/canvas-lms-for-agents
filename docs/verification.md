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
