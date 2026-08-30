import { useEffect } from 'react';
import { EntryScreen } from './EntryScreen.tsx';
import { LobbyScreen } from './LobbyScreen.tsx';
import { GoalScreen } from './GoalScreen.tsx';
import { GameTable } from './GameTable.tsx';
import { FinishedScreen } from './FinishedScreen.tsx';
import { actions, useGame } from '../store/gameStore.ts';
import { directionName, phaseName, statusName } from '../theme/meta.ts';
import type { PublicState } from '../../../src/core/types.ts';

const connectionLabel: Record<string, string> = {
  idle: '연결 대기',
  connecting: '연결 중…',
  connected: '연결됨',
  reconnecting: '재연결 중…',
  error: '연결 실패',
};

/**
 * One line, always. It stays on screen while the table scrolls, so every pixel
 * it takes is a pixel of table the player cannot see — on a phone the old
 * two-line version cost 13% of the viewport.
 *
 * The room code is only useful before the game starts (a started room is full),
 * so it gives way to progress once the draft begins.
 */
function StatusBar() {
  const state = useGame((s) => s.state);
  const roomCode = useGame((s) => s.roomCode);
  if (!state) return null;

  const remaining = state.progress.turnsTotal - state.progress.turnsCompleted;

  return (
    <div className="statusbar">
      {state.phase === 'draft' ? (
        <span className="status-progress">
          <b>R{state.round}/{state.progress.roundsTotal}</b>
          <b>P{state.pick}/{state.progress.picksPerRound}</b>
          <b>{remaining}턴</b>
          <b title={`손패를 ${directionName(state.direction)}으로 전달합니다`}>
            {state.direction === 'left' ? '←' : '→'}
          </b>
        </span>
      ) : (
        <span className="status-progress"><b>{phaseName(state.phase)}</b></span>
      )}
      {state.phase === 'draft' ? <TurnDots state={state} /> : (
        <span className="status-room">방 <b className="room-code">{roomCode}</b></span>
      )}
    </div>
  );
}

/**
 * Turn order, as four dots. The old track was a horizontally scrolling row of
 * named cards; who is up is the only part needed at a glance, and the names are
 * a tap away in the score sheet.
 */
function TurnDots({ state }: { readonly state: PublicState }) {
  const byId = new Map(state.players.map((player) => [player.id, player]));
  return (
    <span className="turn-dots" aria-label="턴 순서">
      {state.turnOrder.map((playerId) => {
        const player = byId.get(playerId);
        if (!player) return null;
        const isCurrent = state.currentPlayerId === playerId;
        const isMe = playerId === state.me?.id;
        return (
          <span
            key={playerId}
            className={`turn-dot${isCurrent ? ' is-current' : ''}${isMe ? ' is-me' : ''}`}
            title={`${player.name} · ${statusName(player.status)}`}
          >
            {isMe ? '나' : player.name.replace(/^Bot /, 'B')}
          </span>
        );
      })}
    </span>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toast-layer" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">{toast.text}</div>
      ))}
    </div>
  );
}

export function App() {
  const connection = useGame((s) => s.connection);
  const state = useGame((s) => s.state);

  // A refresh mid-game should land back in the same seat, not on the entry screen.
  useEffect(() => { void actions.resume(); }, []);

  const myTurn = Boolean(state?.me?.isMyTurn);

  // Once play starts the title has done its job; it shrinks to give the table
  // back the vertical space, which matters most on a phone.
  const playing = state !== null && state.phase !== 'lobby';
  const drafting = state?.phase === 'draft';

  return (
    <main
      className={[myTurn && 'my-turn', playing && 'is-playing', drafting && 'is-drafting']
        .filter(Boolean).join(' ') || undefined}
    >
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">λ</span>
          <div>
            <h1>FP Draft Game</h1>
            <p>함수형 타입클래스를 카드 드래프트로 익히는 4인 게임</p>
          </div>
        </div>
        <span className={`pill is-${connection}`}>{connectionLabel[connection] ?? connection}</span>
      </header>

      <StatusBar />

      {!state && <EntryScreen />}
      {state?.phase === 'lobby' && <LobbyScreen state={state} />}
      {state?.phase === 'goal' && <GoalScreen state={state} />}
      {state?.phase === 'draft' && <GameTable state={state} />}
      {state?.phase === 'finished' && <FinishedScreen state={state} />}

      <Toasts />
    </main>
  );
}
