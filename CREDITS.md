# Credits

## 사운드

카드 조작음은 **Kenney Casino Audio**를 사용합니다.

- 출처: <https://kenney.nl/assets/casino-audio> (Kenney Vleugels, kenney.nl)
- 라이선스: **CC0 1.0** — 저작자 표시는 의무가 아니지만, 출처를 추적할 수 있도록 남깁니다.
- 사용 파일 (`client/public/sounds/`). 카드에 벌어지는 일이 셋이라 녹음도 셋입니다:
  - `card-slide-1..3.ogg` — 덱에서 한 장이 뽑혀 나올 때.
  - `card-place-1..4.ogg` — 카드를 플레이 영역에 놓을 때. 한 판에 15번 들리므로 넷을 돌려 씁니다.
  - `card-shove-1..2.ogg` — 뽑은 카드를 시장으로 밀어 넣고 교환할 때.

내 턴 시작, 시간 임박, Claim, 게임 종료는 녹음이 아니라 `client/src/ui/sound.ts`에서
Web Audio로 합성합니다. 카드 소리는 마찰음이라 녹음이어야 하고, 상태 알림은 서로 구분되는
음정이어야 하기 때문입니다.

Sonniss GDC 번들은 쓰지 않습니다. 라이선스가 사운드 파일 자체("as sound effects")의
재배포를 금지하고 있어, 공개 저장소에 원본을 커밋하는 것과 맞지 않습니다.
