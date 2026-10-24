# Canvas LMS for Agents

**고려대학교 Canvas·LearningX를 Codex와 Claude Code에서 사용하는 한국어 학습 플러그인.**

```text
@Canvas LMS for Agents 인지 PDF 3~5 학습 도와줘
@Canvas LMS for Agents 이번 주 과제랑 출석 확인해줘
@Canvas LMS for Agents 알고리즘 새 공지 요약해줘
@Canvas LMS for Agents 이 자료를 내 Gmail로 보내줘
```

요청한 PDF **전체를 로컬에 다운로드**하고, 전체 텍스트를 추출해 챕터별 학습을 돕습니다. 동일 자료를 다시 요청하거나 Codex와 Claude Code를 번갈아 써도 같은 캐시를 사용합니다. 모델은 사용하는 앱의 모델이며 별도 OpenAI/Anthropic API 키가 필요하지 않습니다. 해당 앱의 구독·사용량 제한은 그대로 적용됩니다.

현재 지원 학교는 **고려대학교**입니다. 학교 공식 제품이 아니며 Syllo와 별도로 동작합니다. 학습 설명과 요약은 AI가 생성하므로 중요한 마감·출결 판정은 함께 제공되는 원본 LMS에서 확인하세요.

## 지원하는 일

| 요청 | 동작 |
|---|---|
| 과목·자료 찾기 | 실제 수강목록, 과목 약칭, 주차·장·자료 번호 구분 |
| PDF 학습 | 파일 전체 다운로드, 전체 텍스트 로컬 저장, 페이지/북마크 조회, 도표·수식 페이지 이미지 분석 |
| 챕터별 공부 | 자료의 실제 구성에 맞춰 개념 설명·예시·확인 질문·연습문제 |
| 공지 요약 | Canvas 공지 + LearningX 게시판 본문·첨부 조회 |
| 과제·퀴즈 확인 | 마감, 제출 상태, 공개된 점수, 원문 링크 |
| 출석 확인 | LearningX 출결현황과 영상 학습 완료 상태 조회 |
| 강의계획·일정 | Canvas 강의계획 본문과 캘린더 조회 |
| 메일 전달 | 다른 Gmail/메일 플러그인에 로컬 자료·요약·LMS 링크 전달 |

`PDF 3~5`는 자료 제목의 번호 3, 4, 5를 뜻합니다. `3~5쪽`, `3~5주차`, `3~5장`은 각각 다른 조건입니다. 제목에서 번호를 확인할 수 없으면 후보 목록으로 확인합니다. 예시의 “인지”라는 과목은 사용자의 실제 수강목록에서 해석하며 기본으로 특정 과목에 고정하지 않습니다.

LMS에서 **조회만** 합니다. LTI 인증 과정에는 로그인용 POST가 필요하지만 과제 제출, 출석 처리, 자동 영상 시청, 게시판 쓰기 기능은 없습니다. Gmail 발송은 별도 메일 도구가 담당합니다.

## 1. 준비

- Node.js **24 이상**, npm, Git
- 로컬에서 실행하는 Codex 또는 Claude Code
- 고려대 Canvas에 접근할 수 있는 본인의 계정과 개인 토큰
- PDF 캐시용 디스크 공간: 기본 계정당 1 GB

```powershell
node --version
git --version
```

**토큰 방식의 범위:** 이 저장소는 요청에 따라 로컬 개인 토큰 방식으로 구현했습니다. [Canvas 공식 인증 문서](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)는 본인 개발 테스트에 수동 토큰을 설명하며, 다른 사용자에게 수동 토큰 입력을 요구하는 앱은 정책에 맞지 않고 다중 사용자 앱은 OAuth를 사용해야 한다고 명시합니다. 코드 공개가 학교나 Canvas의 서비스 배포 승인을 의미하지 않습니다. 여러 학생을 대상으로 서비스화할 때에는 학교의 인증·이용 조건과 OAuth 전환을 먼저 해결해야 합니다.

## 2. Codex에 설치

Node.js 24 이상(npm 포함), Git, 로컬 Codex가 준비되어 있으면 아래 두 명령만 실행합니다. 저장소 clone, `npm ci`, `npm run setup`은 필요 없습니다.

```powershell
codex plugin marketplace add iamnotfemale/canvas-lms-for-agents
codex plugin add canvas-lms-for-agents@canvas-lms-for-agents
```

Codex 앱을 다시 시작하고 새 로컬 채팅에서 `@` → **Canvas LMS for Agents**를 선택합니다.

```text
@Canvas LMS for Agents 내 수강 과목 보여줘
```

**첫 사용 시 로컬 브라우저에 토큰 입력 화면이 열립니다.** 설치 화면에서 연결 설정을 선택해도 같은 화면으로 안내합니다.

1. 화면의 **고려대 Canvas 설정 열기**를 눌러 로그인합니다.
2. 계정 설정 → 승인된 통합 → 새 액세스 토큰을 만들어 복사합니다. 학교가 메뉴를 제공하지 않으면 학교 관리자에게 확인하세요.
3. 로컬 화면의 **Canvas 개인 액세스 토큰** 입력란에 붙여 넣고 **연결하고 시작하기**를 누릅니다.
4. 연결 완료 후 같은 채팅으로 돌아가 요청을 이어갑니다. 토큰 설정 때문에 앱을 다시 시작할 필요는 없습니다.

브라우저가 자동으로 열리지 않으면 에이전트가 제공한 로컬 연결 링크를 엽니다. 링크는 10분 후 만료되므로 만료되었다면 “LMS 연결 설정 다시 열어줘”라고 요청하세요. 토큰은 채팅에 입력하지 않습니다.

이미 토큰을 설정했다면 그대로 사용합니다. 토큰 교체도 “LMS 연결 설정 다시 열어줘”로 할 수 있습니다. 설정은 `~/.config/canvas-lms-for-agents/config.json`에 저장하며 Unix 0600/0700, Windows 사용자 ACL로 보호합니다. 암호화 저장소는 아닙니다.

`codex plugin` 명령이 없다면 Codex를 업데이트하세요. 이 설치는 GitHub 마켓플레이스 설치이며 OpenAI 공개 디렉터리 등록을 뜻하지 않습니다. 설치했지만 현재 채팅에 도구가 없으면 새 로컬 채팅에서 호출하세요.

## 3. Claude Code에 설치

```bash
claude plugin marketplace add iamnotfemale/canvas-lms-for-agents
claude plugin install canvas-lms-for-agents@canvas-lms-for-agents --scope user
```

Claude Code를 다시 시작하고 호출합니다.

```text
/canvas-lms-for-agents:canvas-lms 인지 PDF 3~5 학습 도와줘
```

최초 사용 시 같은 로컬 토큰 화면이 열립니다. Codex와 같은 OS 사용자라면 설정과 다운로드를 공유하므로 다시 입력할 필요가 없습니다. 다른 컴퓨터나 원격 실행 환경에는 파일이 자동 공유되지 않습니다.

## 4. PDF 저장 위치

첫 연결 시 실제 바탕화면에 `Canvas LMS` 폴더를 만듭니다. 자료를 요청하면 학기·과목별로 저장합니다.

```text
바탕화면/Canvas LMS/
  2026년 2학기/
    과목명 - 01분반/
      Chapter13. Vectors functions.pdf
```

Windows에서는 OneDrive 등으로 옮긴 실제 바탕화면 위치도 따릅니다. 학기를 확인할 수 없으면 `학기 미확인` 폴더를 사용합니다. 파일명에서 OS가 금지한 문자만 정리하고, 같은 이름의 다른 내용이나 직접 수정한 PDF가 있으면 구분자를 붙여 보존합니다.

이 폴더는 **보관용**입니다. 분석 캐시를 지워도 PDF는 남습니다. 원본과 버전이 같고 LMS 접근권이 있으면 보관용 PDF로 캐시를 복원하여 다시 다운로드하지 않습니다. 직접 필기한 파일이 분석 캐시까지 바꾸지 않도록 원본 캐시와 보관본은 별도 복사본이며 그만큼 디스크를 사용합니다.

## 5. Gmail과 같이 사용하기

Gmail 기능을 이 플러그인에 중복 구현하지 않았습니다. 사용하는 앱에 Gmail/메일 플러그인을 설치·연결하고 이렇게 요청합니다.

```text
인지 PDF3을 내려받아서 example@example.com으로 첨부해서 보내줘.
제목은 '인지과학 3강 자료'로 해줘.
```

학습 플러그인이 자료의 실제 로컬 경로를 준비하고, 에이전트가 메일 도구의 첨부 지원을 확인합니다. 메일 도구가 로컬 첨부를 지원하지 않으면 자동 발송 성공으로 처리하지 않고 요약+LMS 링크 등의 대안을 알려줍니다. 로컬 경로는 다른 사람이 열 수 있는 링크가 아니며, LMS 링크는 수신자에게 별도 학교 접근 권한이 필요합니다. 원문 강의자료를 보낼 때는 전달 가능한 자료와 수신자인지 확인하세요.

## 캐시와 속도

브라우저 `localStorage`가 아닌 **로컬 파일 캐시**입니다. 아래 `original.pdf`는 내부 분석 원본이고, 사용자가 여는 파일은 위 바탕화면 폴더의 실제 파일명입니다.

기본 내부 경로는 Windows에서 `D:/Dev`가 있으면 `D:/Dev/AppData/canvas-lms-for-agents`, 없으면 `%LOCALAPPDATA%/canvas-lms-for-agents`입니다. macOS/Linux는 `~/.local/share/canvas-lms-for-agents`(또는 `XDG_DATA_HOME`)를 사용합니다.

플러그인의 기본 실행 코드는 패키지에 포함됩니다. **PDF를 처음 분석할 때만** PDF 엔진을 자동 설치하며 인터넷과 npm이 필요합니다. 고정된 lockfile로 설치하고 설치 스크립트는 실행하지 않습니다. 최초 준비에는 추가 시간이 걸리지만 이후에는 설치된 엔진을 재사용합니다. PDF 다운로드와 공지 조회에는 이 설치가 필요하지 않습니다.

```text
지정한 캐시 폴더/
  학교와 계정 ID의 해시/
    index.json                  # 자료 ID → 내용 해시, 버전, 마지막 사용 시각
    objects/<SHA-256>/
      original.pdf              # PDF 전체 원본
      document-v1.md            # 전체 추출 텍스트
      document-v1.json          # 전체 페이지 미리보기
      text-v1-1.json            # 페이지별 텍스트
      page-v1-1.png             # 요청한 페이지만 렌더링
```

- **안정된 키:** 학교+계정으로 분리하고 Canvas 파일 ID 또는 LearningX 항목 ID로 찾습니다. 파일명 중복이나 서명 URL 변경으로 새 복사본을 만들지 않습니다.
- **내용 중복 제거:** 같은 계정의 서로 다른 자료 ID라도 바이트가 같으면 SHA-256 원본 한 개를 공유합니다. 처음 보는 서로 다른 ID의 내용 동일 여부는 최초 다운로드 후에 알 수 있습니다.
- **갱신:** Canvas의 수정 시각·크기로 버전을 비교합니다. 안정된 수정 정보가 없는 LearningX 자료는 2분 동안 재사용하고 이후 ETag/Last-Modified 조건부 요청으로 확인합니다. 서버에 검증 헤더가 없으면 다시 다운로드해야 합니다.
- **권한:** 캐시를 반환하기 전 현재 사용자·과목·자료 권한을 다시 확인합니다. 토큰 만료/권한 취소를 캐시로 우회하지 않습니다. 따라서 재사용 시에도 학교 API 지연이 있습니다.
- **완전한 파일:** `.part`에 스트리밍 → PDF 헤더·응답 길이 검사 → 해시 검증 → 원자적 저장. 실패한 다운로드를 정상 파일로 취급하지 않습니다.
- **동시 요청:** 요청 병합과 프로세스 간 잠금으로 Codex·Claude Code가 같은 자료를 동시에 받아도 중복 저장·다운로드를 방지합니다.
- **용량:** 기본 계정당 1 GB. 최근 사용이 오래된 PDF와 파생 텍스트·이미지를 함께 정리합니다. 처리 중인 현재 문서는 보존하므로 파생 데이터가 큰 단일 문서는 한도를 일시적으로 초과할 수 있습니다.
- **제한:** PDF 파일당 최대 100 MB, 전체 텍스트 색인은 최대 1,500쪽. 페이지 미리보기 응답은 최대 120쪽이며 전체 목록은 로컬 JSON에 있습니다. 페이지 읽기는 한 번에 8쪽, 이미지 긴 변은 최대 1,800 px입니다.
- **낮은 지연:** 선택한 과목만 조회, 목록 짧은 메모리 캐시, 최대 3개 모듈 동시 조회, PDF/이미지 라이브러리 지연 로딩, 전체 텍스트 재사용. 전체 수강자료를 시작할 때 선제 다운로드하지 않습니다.

개발 clone에서 사용할 수 있는 관리 명령:

```bash
npm run cache -- status
npm run cache -- prune
npm run cache -- clear --yes
```

`prune`은 한도를 넘은 오래된 자료와 24시간 이상 지난 다운로드 임시파일을 정리합니다. `clear --yes`는 **현재 인증된 계정의 캐시만** 삭제합니다. 개인이 따로 작성한 학습 노트를 캐시 폴더에 저장하지 마세요. 인증할 수 없는 오래된 계정의 캐시는 앱을 종료하고 지정한 캐시 폴더에서 직접 관리할 수 있습니다.

설정 파일의 `maxCacheMB`, `cacheDir`, `libraryDir`, `aliases`를 바꿀 수 있습니다. 토큰이 든 파일 전체를 채팅에 보여주지 마세요. 예를 들어 aliases에 `"인지": "12345"`를 넣으면 실제 수강목록에서 그 과목 ID로 해석합니다. `12345`는 예시이며 본인의 `list_courses` 결과를 사용해야 합니다. 변경 후 MCP를 재시작합니다.

고급 실행 환경에서는 `CANVAS_TOKEN`, `CANVAS_AGENT_CACHE_DIR`, `CANVAS_AGENT_CONFIG_DIR` 환경변수를 사용할 수 있습니다. 보통은 setup이 더 간단하며 토큰을 셸 명령 인수에 직접 적지 않는 편이 좋습니다.

## 오류 해결

| 상황 | 확인 방법 |
|---|---|
| `node`를 못 찾음 | Node 24+ 설치 후 앱을 완전히 다시 시작해 PATH 반영 |
| 이전 버전의 `npm run setup` 오류 | 아래 업데이트로 0.2.0 이상 설치 후 새 채팅에서 호출 |
| PDF 엔진 자동 설치 실패 | 인터넷·npm·폴더 쓰기 권한 확인 후 같은 요청 재시도 |
| 연결 401 | `connection_status`로 토큰 확인. 파일 목록만 401이면 토큰 전체 만료로 단정하지 않음 |
| 파일 목록 접근 제한 | 모듈·LearningX 경로로 계속 찾음. warnings에 실패 경로 표시 |
| 출석 메뉴 없음 | 해당 과목의 LearningX 메뉴와 학교 원문 확인. 결석으로 추정하지 않음 |
| “자료 없음” 또는 약칭 모호 | 정식 과목명/ID, 자료 제목을 확인. 학기·분반이 겹치면 선택 |
| PDF 글자가 적음 | 스캔/그림 위주일 수 있음. 페이지 렌더링으로 확인. 전체 OCR 엔진은 미포함 |
| 플러그인 수정이 반영 안 됨 | 아래 업데이트 후 앱/MCP 재시작 |
| 네트워크 없이 캐시 읽기 실패 | 권한 재확인이 필요한 설계. 이미 내려받은 파일을 본인이 직접 여는 것은 별개 |

## 업데이트·제거

사용하는 앱의 명령만 실행합니다. Codex:

```bash
codex plugin marketplace upgrade canvas-lms-for-agents
codex plugin remove canvas-lms-for-agents@canvas-lms-for-agents
codex plugin add canvas-lms-for-agents@canvas-lms-for-agents
```

Claude Code:

```bash
claude plugin marketplace update canvas-lms-for-agents
claude plugin update canvas-lms-for-agents@canvas-lms-for-agents
```

업데이트 후 앱을 다시 시작합니다. 0.1.0에서 로컬 clone을 마켓플레이스로 등록했다면 그 clone에서 먼저 `git pull --ff-only`를 실행한 뒤 다시 설치합니다. 0.2.0 실행에는 개발 clone이나 `runtimeRoot`가 필요 없습니다. 기존 토큰과 캐시는 유지되며 기존 PDF도 다음 요청 때 재다운로드 없이 바탕화면에 보관합니다.

플러그인 제거만으로 토큰·보관 PDF·내부 캐시는 삭제하지 않습니다. 완전히 제거하려면 앱을 종료하고 설정 폴더와 자료·내부 캐시 폴더를 정리한 뒤 학교에서 토큰을 폐기하세요.

## 개발·검증

```bash
git clone https://github.com/iamnotfemale/canvas-lms-for-agents.git
cd canvas-lms-for-agents
npm ci
npm run build
npm test
npm run check
```

`src/` 수정 후 `npm run build`로 `plugin/dist/server.mjs`를 재생성하고 함께 커밋합니다. CLI 토큰 설정이 필요하면 개발 clone에서 `npm run setup`을 선택적으로 사용할 수 있습니다.

실계정 검증은 본인 설정 후 명시적으로 실행합니다. 학교 데이터 원문을 출력하지 않고 성공 여부·개수·시간만 출력합니다. 첫 4개 과목 중 PDF가 있는 과목 하나를 골라 실제 PDF 한 개를 내려받아 분석합니다.

```bash
node scripts/verify-live.mjs
```

[검증 기록](docs/verification.md)에는 합성 자동 테스트와 실계정 측정 범위가 구분되어 있습니다. [보안과 데이터 흐름](SECURITY.md), [설계와 Syllo의 역할 구분](docs/design.md)도 참고하세요.

학교 데이터·PDF·토큰은 이 저장소와 테스트 fixture에 포함하지 않습니다. GitHub Actions는 합성 자료만 사용합니다. `plugin/`은 설치 패키지, `src/`는 공유 런타임, `test/`는 합성 검증입니다.

## 참고

- [Codex 플러그인 패키징](https://developers.openai.com/plugins/build/plugins)
- [Codex 로컬 MCP 플러그인](https://developers.openai.com/plugins/deploy/desktop-only)
- [Claude Code 플러그인](https://code.claude.com/docs/en/plugins)
- [Canvas 인증 문서](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)

MIT License. 고려대학교·Instructure·OpenAI·Anthropic의 공식 플러그인이 아닙니다.
