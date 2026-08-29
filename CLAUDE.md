# CLAUDE.md

이 문서는 Claude가 `func-game` 작업을 이어갈 때 사용하는 프로젝트 지침이다. 사용자에게는 기본적으로 한국어로 답한다.

## 프로젝트 목표

FP Draft Game v0.1은 함수형 프로그래밍의 타입클래스와 조합을 카드 드래프트로 익히는 4인용 브라우저 게임이다. Node.js HTTP 서버와 WebSocket을 사용하며, 서버가 authoritative state를 소유한다.

UI에서는 다음 용어를 사용한다.

- 내 손패
- 내 플레이 영역
- 상대 플레이 영역
- 시장

`Workbench`라는 용어는 사용하지 않는다.

## 작업 시작 절차

```bash
npm install
npm test
npm start
```

- 기본 주소: `http://localhost:3107`
- WebSocket 경로: `/ws`
- 서버 바인딩: `0.0.0.0`
- 포트 변경: `PORT=4000 npm start`
- 외부 기기에서는 서버 머신의 LAN 주소나 Tailscale 주소로 접근한다.
- 현재 저장소에는 Git remote가 없을 수 있다. push나 PR을 전제로 작업하지 말고 `git remote -v`로 먼저 확인한다.

변경 전후에 반드시 `npm test`를 실행한다. 모바일 UI를 수정하면 최소 375×812 뷰포트에서 `document.documentElement.scrollWidth === window.innerWidth`인지 확인한다.

## 디렉터리 구조

```text
public/
  index.html       브라우저 마크업
  app.js           WebSocket 클라이언트와 렌더링
  style.css        반응형 UI와 카드 시각 언어
src/game/
  cards.js         66장 덱 정의
  combos.js        조합 판정과 최고 단계 점수 선택
  game.js          방, 턴, Claim, 봇, 공개 상태 규칙
  goals.js         비밀 목표
  program.js       Free 명령 DSL과 State interpreter
  random.js        셔플
  scoring.js       조합, Utility, Claim 점수
src/server/
  game-store.js    메모리 기반 방 Actor 저장소
  room-actor.js    방별 Actor 생성과 Promise 어댑터
  server.js        HTTP, WebSocket, 봇 스케줄러
test/              node:test 기반 규칙 및 동시성 테스트
```

## 아키텍처

명령 처리 흐름은 다음과 같다.

```text
브라우저 WebSocket 메시지
  -> Free.api로 선언된 Game 명령
  -> 방별 Actor.send(program)
  -> gameInterpreter
  -> State<Room, Result>
  -> 새 방 상태
  -> viewer별 publicState
  -> WebSocket broadcast
```

역할을 섞지 않는다.

- `Free`: 무엇을 실행할지 표현하는 게임 명령 DSL
- `State`: 원본 방을 보존하는 상태 전이
- `Actor`: 같은 방으로 들어온 명령의 순차 실행
- `publicState`: 손패와 비밀 목표를 시청자별로 가리는 투영 경계
- `public/`: 서버가 보낸 상태를 표현하고 사용자 명령만 전송

`src/game/program.js`의 State interpreter는 `structuredClone(room)`으로 복제한 뒤 기존 규칙 함수를 적용한다. 따라서 Actor가 가진 이전 방 객체는 실패한 명령으로 변경되지 않는다. 기존 규칙 함수는 내부적으로 복제본을 변경하므로, 이를 완전한 불변 구현이라고 오해하지 않는다.

새로운 상태 변경 명령을 추가할 때는 다음 순서를 따른다.

1. `src/game/game.js`에 규칙과 검증을 구현한다.
2. `src/game/program.js`의 `Game` 어휘와 interpreter handler를 함께 추가한다.
3. 서버는 규칙 함수를 직접 호출하지 않고 `sendToActor(actor, Game.command(...))`를 사용한다.
4. 성공, 잘못된 턴, 실패 후 Actor 큐 복구를 테스트한다.

## WebSocket 명령

클라이언트가 보내는 메시지 타입은 다음과 같다.

- `create_room`: `{ name }`
- `join_room`: `{ roomId, name }`
- `start_game`
- `choose_goal`: `{ goalId }`
- `pick`: `{ cardId, marketCardId? }`
- `claim`: `{ container, name }`
- `finish_claim`

서버 응답은 `hello`, `state`, `error`다. 클라이언트에 방 객체를 그대로 보내지 말고 항상 `publicState(room, playerId)`를 사용한다.

내부 `Game` 어휘에는 위 동작 외에 `botTurn`과 `setConnection`이 있다.

## 확정된 게임 규칙

- 정확히 4자리이며 빈자리는 게임 시작 시 Bot으로 채운다.
- 시작할 때 자리 순서를 무작위로 정한다.
- 3라운드, 라운드당 5장, 총 60턴이며 각 플레이어는 15장을 플레이한다.
- 패스 방향은 Round 1 왼쪽, Round 2 오른쪽, Round 3 왼쪽이다.
- 각 Pick의 시작 플레이어는 한 자리씩 순환한다.
- 한 Pick에서 네 플레이어가 순서대로 한 번씩 행동한 뒤 손패를 전달한다.
- 중앙 시장은 4장이고 Market Token이나 예약은 없다.
- 현재 플레이어만 손패 한 장을 선택하거나 시장 카드와 즉시 교환할 수 있다.
- 시장 교환은 손패 카드를 시장에 놓고 시장 카드를 플레이 영역에 추가하며 한 턴을 소비한다.
- 플레이 영역과 진행 중 공개 점수는 모두에게 보인다.
- 손패, 목표 후보, 선택한 비밀 목표는 본인에게만 보인다.
- 비밀 목표 점수는 게임 종료 전 공개 점수에 포함하지 않는다.
- 새 조합을 완성하면 Claim하거나 건너뛸 수 있다. Claim 선택이 끝날 때까지 다음 턴은 진행하지 않는다.
- 같은 `Container:Combo` Claim은 게임 전체에서 한 번만 가능하며 Claim당 1점이다.
- 봇은 새 조합을 자동 Claim한다.
- 봇 행동은 서버가 450~850ms 뒤 예약한다. 타이머 안에서 현재 봇 턴인지 다시 확인하고 Actor 큐를 기다리는 동안 막지 않는다.
- 게임 중 연결이 끊긴 사람의 턴에는 현재 진행이 멈춘다. 재접속 세션 복구는 아직 없다.

## 카드와 점수

덱은 66장이다. 정확한 수량은 `src/game/cards.js`를 기준으로 하며 `test/deck.test.js`가 검증한다.

기본 조합은 컨테이너별 최고 단계 하나만 계산한다.

| 조합 | 필요 카드 | 점수 |
|---|---|---:|
| Functor | map | 2 |
| Apply | map + ap | 4 |
| Applicative | map + ap + pure | 6 |
| Monad | map + ap + pure + chain | 9 |

특수 조합은 기본 조합과 별도로 계산한다.

| 조합 | 필요 카드 | 점수 |
|---|---|---:|
| Maybe Alternative | map + ap + pure + alt + zero | 11 |
| Either Bifunctor | map + bimap | 6 |
| List Foldable | map + reduce | 6 |
| List Traversable | map + reduce + traverse | 10 |

Utility는 서로 다른 종류 수로 점수를 계산한다.

- 2종 1점
- 3종 4점
- 4종 7점
- 5종 11점
- 6종 16점
- 7종 이상은 종류마다 4점 추가

조커 소비와 조합 판정은 `src/game/combos.js`가 유일한 기준이다. 하나의 카드를 한 조합의 여러 요구 슬롯에 중복 사용하게 만들지 않는다.

## fun-fp-js 사용 원칙

현재 `fun-fp-js@0.2.2`를 정확한 버전으로 고정한다.

- `pipe`, `curry`: 점수 계산
- `Maybe`: viewer 조회와 공개 상태 투영
- `Free.api`: 게임 명령과 실행 분리
- `State`: 방 상태 전이
- `Actor`: 방별 명령 직렬화

함수형 추상화를 모든 코드에 강제로 적용하지 않는다. DOM 렌더링, HTTP 파일 제공, WebSocket 연결 수명주기처럼 부수효과가 핵심인 경계는 명시적인 코드로 유지한다. `Either` 등 새 추상화를 도입할 때는 실제 실패 모델과 테스트 이점이 있을 때만 사용한다.

## UI 원칙

- 현재 턴, 턴 순서, 플레이어 상태, 이벤트, 공개 점수가 한눈에 보여야 한다.
- 카드에는 컨테이너 색상, 연산 기호, 기능 힌트를 유지한다.
- 모바일에서 문서 전체가 가로 스크롤되면 안 된다.
- 턴 순서와 손패는 자체 영역 안에서만 가로 스크롤할 수 있다.
- `.turn-board > * { min-width: 0; }`는 Grid 최소 콘텐츠 폭이 문서를 확장하지 않게 하는 회귀 방지 규칙이다. 이유 없이 제거하지 않는다.
- 비밀 정보가 DOM이나 WebSocket payload에 섞이지 않도록 서버 투영에서 먼저 제거한다. CSS로 숨기는 것은 보안 경계가 아니다.

## 테스트와 완료 조건

현재 테스트는 Node 내장 `node:test`를 사용한다.

```bash
npm test
git diff --check
```

변경 유형별 최소 검증은 다음과 같다.

- 규칙 변경: 정상 경로와 잘못된 턴/상태를 단위 테스트
- Free/State 변경: 원본 상태 보존과 interpreter 결과 테스트
- Actor 변경: 동시 명령 순서, 실패 후 다음 명령 처리 테스트
- 공개 상태 변경: 상대 손패와 비밀 목표가 직렬화 결과에 없는지 테스트
- 봇 변경: 한 명령이 한 턴만 실행하고 오래된 예약 명령을 거부하는지 테스트
- 반응형 UI 변경: 375×812와 데스크톱에서 확인하고 브라우저 콘솔 오류 검사
- 서버 변경: `http://127.0.0.1:3107` HTTP 200과 `ws://127.0.0.1:3107/ws` 연결 확인

테스트 개수는 바뀔 수 있으므로 고정된 숫자를 문서의 성공 조건으로 사용하지 않는다. 실패한 테스트를 삭제하거나 완화해 통과시키지 않는다.

## 작업 규율

- 관련 없는 사용자 변경을 되돌리지 않는다.
- 파일 검색은 `rg`와 `rg --files`를 우선 사용한다.
- 실제 원인을 재현하기 전에는 버그 수정을 시작하지 않는다.
- 수정은 요청 범위에 필요한 파일로 제한한다.
- 새 의존성은 필요성과 현재 배포 버전을 확인한 뒤 추가한다.
- 서버 프로세스를 재시작했다면 HTTP와 WebSocket을 다시 확인한다.
- 커밋은 검증이 끝난 논리 단위로 만들고, push는 사용자가 명시적으로 요청했으며 remote가 확인된 경우에만 한다.

## 알려진 미구현 항목

- Trade
- 재접속 토큰과 세션 복구
- 턴 제한 시간과 시간 초과 Bot 대행
- Redis 또는 DB 영속화
- 관전자
- 방 비밀번호
- Claim 특수 능력
- 고급 봇 전략

이 목록의 항목은 요청 없이 선제 구현하지 않는다. 규칙이나 밸런스를 변경할 때는 README와 이 문서를 함께 갱신한다.
