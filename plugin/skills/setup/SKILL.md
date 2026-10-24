---
name: setup
description: Canvas LMS for Agents를 처음 연결하거나 개인 액세스 토큰을 교체할 때 로컬 입력 화면을 연다.
---

`connection_status`로 연결을 확인한다. 연결되어 있으면 저장 폴더와 사용 예시를 짧게 안내한다. 토큰 교체를 명시적으로 요청하면 `setup_connection`을 호출한다.

`setupRequired` 응답이면 `setupUrl`의 로컬 입력 화면이 열렸음을 알린다. 브라우저가 열리지 않았다면 클릭 가능한 링크를 보여준다. 토큰을 채팅·도구 인수·로그로 받거나 대신 읽어 입력하지 않는다. 사용자가 완료했다고 하면 `connection_status`를 다시 호출하고 원래 요청을 이어간다. 서버를 재시작하거나 수동 clone/npm/setup을 요구하지 않는다.

일반 사용자는 플러그인 설치와 Node.js 24+만 필요하다. PDF 분석 엔진은 첫 분석 때 자동 준비되며 이후 재사용된다. 토큰 연결이 완료되면 바탕화면의 Canvas LMS 폴더가 만들어지고 PDF가 학기/과목/실제파일명으로 저장된다.
