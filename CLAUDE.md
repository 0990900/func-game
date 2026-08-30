# CLAUDE.md

이 문서는 Claude가 `func-game` 작업을 이어갈 때 사용하는 프로젝트 지침이다. 사용자에게는 기본적으로 한국어로 답한다.

## 프로젝트 목표

FP Draft Game v0.1은 함수형 프로그래밍의 타입클래스와 조합을 카드 드래프트로 익히는 4인용 브라우저 게임이다. Node.js HTTP 서버와 WebSocket을 사용하며, 서버가 authoritative state를 소유한다.

UI에서는 다음 용어를 사용한다.

- 뽑은 카드
- 시장
- 내 플레이 영역
- 상대 플레이 영역
- 타입클래스

`Workbench`는 사용하지 않는다. **`손패`도 사용하지 않는다** — 손패는 없어졌고 차례가 되면 덱에서 한 장을 뽑는다.

## 두 스택이 공존한다

마이그레이션이 진행 중이라 **신규 스택과 레거시 스택이 같이 있다.** 새 작업은 전부 신규 스택에서 한다.

| | 신규 (작업 대상) | 레거시 (컷오버까지 유지) |
|---|---|---|
| 규칙 코어 | `src/core/` — TypeScript + Effect | `src/game/` — JS + fun-fp-js |
| 서버 | `src/server/colyseus.ts`, `draft-room.ts` — Colyseus, 2567 | `src/server/server.js` — 커스텀 ws, 3107 |
| 클라이언트 | `client/` — React + PixiJS + zustand, Vite | `public/` — 바닐라 DOM |

두 코어는 **규칙이 이미 갈라졌다.** 레거시는 옛 손패 규칙을 그대로 돌린다. 레거시 테스트는 컷오버(마일스톤 G)까지 남겨두되, 규칙 변경은 `src/core/`에만 반영한다.

## 작업 시작 절차

```bash
npm install
npm test                  # 신규 TS + 레거시 JS 테스트 모두
npm run typecheck         # 서버·코어
npm run start:colyseus    # 신규 서버 (2567)
cd client && npm run dev  # Vite 개발 서버
```

- 클라이언트가 `import.meta.env.DEV`일 때 2567로 붙는다.
- 서버 바인딩: `0.0.0.0`
- 레거시는 `npm start` (3107). 사용자가 직접 띄워둔 경우가 있으니 **함부로 종료하지 않는다.**
- 외부 기기에서는 서버 머신의 LAN 주소나 Tailscale 주소로 접근한다.
- 현재 저장소에는 Git remote가 없을 수 있다. push나 PR을 전제로 작업하지 말고 `git remote -v`로 먼저 확인한다.

변경 전후에 반드시 `npm test`를 실행한다. 모바일 UI를 수정하면 최소 375×812 뷰포트에서 `document.documentElement.scrollWidth === window.innerWidth`인지 확인한다.

## 디렉터리 구조

```text
src/core/            신규 규칙 코어 (TypeScript + Effect)
  cards.ts           덱 정의. 컨테이너별 연산은 specs 한 곳에서 나온다
  combos.ts          조합 정의·판정·Claim 가능 여부
  scoring.ts         조합/Utility/Claim 점수
  goals.ts           비밀 목표
  rules.ts           방·턴·Claim·봇·턴 마감·점수 기록
  commands.ts        GameCommand 어휘와 Effect 실행기
  public-state.ts    시청자별 투영
  services.ts        Rng / IdGen / Clock (주입 가능)
  testing.ts         결정적 테이블 harness
src/server/
  colyseus.ts        신규 엔트리 (2567)
  draft-room.ts      Colyseus Room. 봇과 사람의 턴 타이머를 하나로 관리
  game-runtime.ts    방별 명령 직렬화 (Semaphore(1))
client/src/
  net/               Colyseus SDK 연결
  store/gameStore.ts zustand. 상태·선택·시계 오차·보기 토글
  pixi/              TableScene(테이블), CardSprite(앞뒷면), effects, motion
  components/        React 셸·Dock·시트·그래프·종료 화면
  theme/             색·기호·한글 힌트·타입 서명
  ui/                점수 시리즈, 결과 이미지, 뷰포트
src/game/, public/   레거시. 컷오버까지 유지
test/                node:test. *.test.ts는 신규, *.test.js는 레거시
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
- `publicState`: 비밀 목표와 목표 후보를 시청자별로 가리는 투영 경계
- `public/`: 서버가 보낸 상태를 표현하고 사용자 명령만 전송

`src/game/program.js`의 State interpreter는 `structuredClone(room)`으로 복제한 뒤 기존 규칙 함수를 적용한다. 따라서 Actor가 가진 이전 방 객체는 실패한 명령으로 변경되지 않는다. 기존 규칙 함수는 내부적으로 복제본을 변경하므로, 이를 완전한 불변 구현이라고 오해하지 않는다.

새로운 상태 변경 명령을 추가할 때는 다음 순서를 따른다.

1. `src/game/game.js`에 규칙과 검증을 구현한다.
2. `src/game/program.js`의 `Game` 어휘와 interpreter handler를 함께 추가한다.
3. 서버는 규칙 함수를 직접 호출하지 않고 `sendToActor(actor, Game.command(...))`를 사용한다.
4. 성공, 잘못된 턴, 실패 후 Actor 큐 복구를 테스트한다.

## WebSocket 명령

방 생성·참가는 Colyseus 매치메이킹(`client.create`/`joinById`)이 처리한다. 방 안에서 클라이언트가 보내는 메시지는 다음과 같다.

- `start_game`
- `restart_game`
- `choose_goal`: `{ goalId }`
- `pick`: `{ cardId, marketCardId? }`
- `claim`: `{ container, name }`
- `finish_claim`

서버는 `state`와 `error`를 보낸다. `state`에는 `{ state: publicState(room, playerId), serverNow }`가 담긴다. `serverNow`는 클라이언트가 시계 오차를 보정해 턴 카운트다운을 그리기 위한 값이다. **방 객체를 그대로 보내지 말고 항상 `publicState`를 쓴다.**

내부 `GameCommand` 어휘에는 위 동작 외에 `joinRoom`, `botTurn`, `setConnection`이 있다.

## 확정된 게임 규칙

손패는 없다. 차례가 되면 덱에서 한 장을 뽑고, 그 한 장으로만 행동한다.

- 정확히 4자리이며 빈자리는 게임 시작 시 Bot으로 채운다.
- 시작할 때 자리 순서를 무작위로 정한다.
- 총 60턴이며 각 플레이어는 15장을 플레이한다. 덱이 비어도 끝난다.
- 라운드와 Pick 개념은 없다. `round`/`pick` 필드는 제거됐다.
- 진행 방향은 왼쪽에서 시작하고, `순서 바꾸기` 카드가 나오면 뒤집힌다.
- `순서 바꾸기` 카드는 덱에 1장 있고 플레이되지 않는다. 뽑히면 버리고 다시 뽑으며, 방향은 그 턴이 끝난 뒤 바뀐다.
- 중앙 시장은 4장이고 Market Token이나 예약은 없다.
- 현재 플레이어만 뽑은 카드를 놓거나 시장 카드와 즉시 교환할 수 있다.
- 시장 교환은 뽑은 카드를 시장에 놓고 시장 카드를 플레이 영역에 추가하며 한 턴을 소비한다.
- 뽑은 카드는 모두에게 보인다. 플레이 영역과 진행 중 공개 점수도 모두에게 보인다.
- 목표 후보와 선택한 비밀 목표는 본인에게만 보인다.
- 비밀 목표 점수는 게임 종료 전 공개 점수에 포함하지 않는다.
- 새 조합을 완성하면 Claim하거나 건너뛸 수 있다. Claim 선택이 끝날 때까지 다음 턴은 진행하지 않는다.
- **조커만으로 이룬 조합은 Claim할 수 없다.** 해당 조합이 요구하는 연산 중 하나 이상을 그 컨테이너의 실제 카드로 가지고 있어야 한다. 점수는 조커로도 계산된다.
- 같은 `Container:Combo` Claim은 게임 전체에서 한 번만 가능하며 Claim당 1점이다.
- 봇은 새 조합을 자동 Claim한다.
- **턴 제한시간은 30초(`TURN_LIMIT_MS`)다.** 규칙이 `room.turnEndsAt`에 마감을 찍고 서버가 그 시각에 타이머를 건다. 시간이 지나면 뽑은 카드를 그대로 놓고, Claim 대기 중이면 Claim 없이 넘어간다.
- 봇 행동도 같은 타이머가 처리한다. 봇은 450~850ms, 사람은 마감까지 기다린다. 대기에 키를 붙여 같은 턴 안의 재방송이 타이머를 리셋하지 못하게 한다.
- 매 턴 전원의 공개 점수를 `room.scoreLog`에 기록한다. 최종 점수로는 복원할 수 없는 정보다.
- 게임이 끝나면 방장이 **같은 인원으로 재시작**할 수 있다. 자리·이름·봇 여부·방장은 유지되고 게임 상태만 초기화된다.
- 게임 중 연결이 끊긴 사람의 자리는 120초간 유지되며, 그동안에도 턴 제한시간은 그대로 흘러 자동 진행된다.

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
- 카드 테이블은 캔버스 안에서만 스크롤한다. 문서 자체는 스크롤되지 않는다.
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
- 공개 상태 변경: 비밀 목표와 목표 후보가 다른 시청자의 직렬화 결과에 없는지 테스트
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
