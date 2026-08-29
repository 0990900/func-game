import { useState } from 'react';
import { actions, useGame } from '../store/gameStore.ts';

export function EntryScreen() {
  const connection = useGame((s) => s.connection);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const busy = connection === 'connecting' || connection === 'reconnecting';

  return (
    <section className="panel">
      <h2>게임 시작</h2>
      <p>방을 만들거나, 친구에게 받은 방 코드로 참가하세요. 빈 자리는 Bot이 채웁니다.</p>

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
          onClick={() => actions.join(code, name)}
        >
          참가하기
        </button>
      </div>
    </section>
  );
}
