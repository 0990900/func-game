import { actions, useGame } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

export function LobbyScreen({ state }: { readonly state: PublicState }) {
  const roomCode = useGame((s) => s.roomCode);
  const isHost = state.me?.id === state.hostPlayerId;

  return (
    <section className="panel">
      <h2>대기실</h2>
      <p>
        방 코드 <b className="room-code">{roomCode}</b> 를 친구에게 알려주세요.
      </p>

      <ul className="player-list">
        {state.players.map((player) => (
          <li key={player.id}>
            <b>{player.name}</b>
            {player.id === state.hostPlayerId && <span className="pill">방장</span>}
            {player.id === state.me?.id && <span className="pill">나</span>}
          </li>
        ))}
      </ul>

      <div className="actions">
        <span className="muted">{state.players.length}명 참가 · 빈 자리는 Bot으로 채워집니다</span>
        <button type="button" disabled={!isHost} onClick={actions.startGame}>
          {isHost ? '게임 시작' : '방장이 시작하기를 기다리는 중'}
        </button>
      </div>
    </section>
  );
}
