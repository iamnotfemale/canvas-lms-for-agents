# Canvas LMS for Agents

고려대학교 Canvas·LearningX를 Codex와 Claude Code에서 사용하는 플러그인입니다. 과제와 공지를 확인하고, 강의 PDF를 읽거나 원하는 폴더에 저장할 수 있습니다.

## 시작하기

[Node.js 24 이상](https://nodejs.org/), Git, 로컬에서 실행하는 Codex 또는 Claude Code가 필요합니다.

### Codex

```bash
codex plugin marketplace add iamnotfemale/canvas-lms-for-agents
codex plugin add canvas-lms-for-agents@canvas-lms-for-agents
```

앱을 다시 시작한 뒤 새 채팅에서 `@` → **Canvas LMS for Agents**를 선택하세요.

### Claude Code

```bash
claude plugin marketplace add iamnotfemale/canvas-lms-for-agents
claude plugin install canvas-lms-for-agents@canvas-lms-for-agents --scope user
```

재시작 후 채팅에서 호출하세요.

```text
/canvas-lms-for-agents:canvas-lms 미적분 과제 보여줘
```

### 학교 계정 연결

첫 요청을 보내면 로컬 연결 화면이 열립니다.

1. [고려대 Canvas 설정](https://canvas.korea.ac.kr/profile/settings)의 **승인된 통합**에서 개인 액세스 토큰을 생성합니다.
2. 연결 화면에 토큰을 입력하고 **연결하고 시작하기**를 누릅니다.
3. 같은 채팅으로 돌아가 요청을 이어갑니다.

학교 Canvas 토큰을 사용하세요. 토큰은 본인 컴퓨터에 저장하며, 채팅이나 GitHub에 입력하지 않습니다. 연결 화면이 열리지 않으면 “연결 설정 열어줘”라고 요청하세요.

## 사용하기

과목명과 필요한 정보를 말하세요. 이어지는 질문은 같은 과목에서 처리합니다.

**과제 조회와 저장**

```text
미적분 과제 뭐였지?
그중 아직 제출 안 한 것만 보여줘.
이 과제 첨부 PDF를 바탕화면의 미적분 폴더에 넣어줘.
```

과제의 제목·마감·제출 상태를 간단하게 정리하고, 요청한 첨부 PDF를 저장합니다. 제출 여부를 확인할 수 없는 항목은 따로 표시합니다.

**공지·주차학습·출석**

```text
알고리즘 최근 공지 알려줘.
이번 주 주차학습에 뭐 올라왔어?
게시판 첨부 자료랑 출석 상태도 확인해줘.
```

Canvas와 LearningX의 정보를 조회합니다. 날짜와 마감은 한국 시간으로 표시합니다.

**PDF 학습**

```text
인지 PDF 3~5 같이 공부하자.
첫 번째 자료의 개념부터 설명해줘.
이 페이지의 수식이랑 그림도 풀어서 알려줘.
```

PDF 전체를 내려받아 텍스트를 추출하고, 필요한 페이지의 표·그림·수식을 이미지로 확인합니다. 같은 자료는 로컬 캐시를 재사용합니다.

화면으로 보고 싶다면 **“학습 대시보드 열어줘”**라고 요청하세요. 별도 로컬 브라우저에서 과목과 메뉴를 선택해 조회할 수 있습니다.

## 파일 저장

PDF는 기본적으로 다음 위치에 보관합니다.

```text
바탕화면/
└── Canvas LMS/
    └── 학기/
        └── 과목/
            └── 원래 파일명.pdf
```

다른 위치가 필요하면 “이 자료를 내 과제 폴더에 저장해줘”처럼 요청하세요. 실제 폴더를 확인한 뒤 사본을 저장하며, 기존 파일과 필기는 덮어쓰지 않습니다. 분석 캐시를 정리해도 보관한 PDF는 남습니다.

내 컴퓨터의 폴더에 저장하려면 플러그인도 로컬에서 실행해야 합니다. PDF 분석 엔진은 첫 분석 때 자동으로 설치됩니다.

## 참고 사항

- 현재 고려대학교를 지원하며, 학교 공식 서비스는 아닙니다.
- LMS는 조회 전용입니다. 과제 제출·출석 처리·자동 영상 시청·게시판 글 작성은 제공하지 않습니다.
- 자동 다운로드·학습은 PDF를 지원합니다. 다른 형식의 첨부와 전체 OCR은 지원하지 않습니다.
- 토큰과 파일은 각 사용자의 컴퓨터에 저장합니다. 설정은 OS 파일 권한으로 보호하며 암호화 저장소는 아닙니다.
- 학습에 사용하는 텍스트와 이미지는 이용 중인 AI 앱에 전달됩니다. 별도 AI API 키는 필요하지 않습니다.

연결이 안 되면 “연결 상태 확인해줘”, 토큰을 교체하려면 “연결 설정 다시 열어줘”라고 요청하세요. 학교에서 접근을 거절하는 경우에는 Canvas 로그인과 계정 권한을 확인해야 합니다.

개인 토큰의 사용·배포 범위는 [Canvas 인증 정책](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)과 학교의 이용 조건을 확인하세요.

## 문서

[사용 가이드](docs/user-guide.md) · [보안](SECURITY.md) · [설계](docs/design.md) · [검증 기록](docs/verification.md) · [MIT License](LICENSE)

<details>
<summary>개발 환경</summary>

Node.js 24 이상을 사용합니다.

```bash
npm ci
npm run build
npm test
npm run check
```

`src/`는 공유 런타임, `plugin/`은 설치 패키지입니다. 런타임 변경 시 번들을 다시 빌드합니다. 자동 테스트는 합성 데이터를 사용합니다.

</details>
