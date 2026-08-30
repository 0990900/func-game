import { useState } from 'react';
import { GameGuide } from './GameGuide.tsx';
import { RoomList } from './RoomList.tsx';
import { actions, useGame } from '../store/gameStore.ts';

export function EntryScreen() {
  const connection = useGame((s) => s.connection);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const busy = connection === 'connecting' || connection === 'reconnecting';

  return (
    <section className="panel">
      <h2>게임 시작</h2>
      <p>이름을 적고 방을 만들거나, 열려 있는 방에 참가하세요. 빈 자리는 Bot이 채웁니다.</p>

      <div className="join">
        <input
          aria-label="플레이어 이름"
          placeholder="이름"
          value={name}
          maxLength={24}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="button" disabled={busy} onClick={() => actions.host(name)}>
          방 만들기
        </button>
      </div>

      <GameGuide />

      <h3>열려 있는 방</h3>
      {/* Observing needs no name and no seat, so it is offered on every room —
          including ones already under way, which are exactly the interesting
          ones to watch. */}
      <RoomList
        busy={busy}
        onJoin={(roomId) => void actions.join(roomId, name)}
        onObserve={(roomId) => void actions.observe(roomId)}
      />

      {/* A room already playing is not in the list, and a friend can still pass
          its code along. */}
      <details className="entry-code">
        <summary>방 코드로 참가</summary>
        <div className="join">
          <input
            aria-label="방 코드"
            placeholder="방 코드"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={busy || !code.trim()}
            onClick={() => void actions.join(code, name)}
          >
            참가하기
          </button>
        </div>
      </details>
    </section>
  );
}
