/**
 * The table. Cards, market and play areas are drawn by Pixi (TableCanvas);
 * the turn track and the pick confirmation stay DOM because they are text and
 * controls — screen readers and keyboard users need them.
 */
import { TableCanvas } from '../pixi/TableCanvas.tsx';
import { statusName } from '../theme/meta.ts';
import { actions, useGame } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

function TurnTrack({ state }: { readonly state: PublicState }) {
  const byId = new Map(state.players.map((player) => [player.id, player]));
  return (
    <div className="turn-track">
      {state.turnOrder.map((playerId, index) => {
        const player = byId.get(playerId);
        if (!player) return null;
        const isCurrent = state.currentPlayerId === playerId;
        return (
          <span key={playerId} style={{ display: 'contents' }}>
            {index > 0 && <i aria-hidden="true">→</i>}
            <span className={`turn-player${isCurrent ? ' is-current' : ''}`}>
              <b>{player.name}</b>
              <span className="muted">{statusName(player.status)}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** A keyboard- and screen-reader-accessible mirror of the canvas hand. */
function HandFallback({ state }: { readonly state: PublicState }) {
  const selectedCardId = useGame((s) => s.selectedCardId);
  const myTurn = Boolean(state.me?.isMyTurn);

  return (
    <div className="sr-hand">
      <h3 className="visually-hidden">내 손패 (키보드 선택)</h3>
      {(state.me?.hand ?? []).map((card) => (
        <button
          key={card.id}
          type="button"
          className="sr-card"
          disabled={!myTurn}
          aria-pressed={card.id === selectedCardId}
          onClick={() => actions.selectCard(card.id)}
        >
          {card.label}
        </button>
      ))}
    </div>
  );
}

export function GameTable({ state }: { readonly state: PublicState }) {
  const selectedCardId = useGame((s) => s.selectedCardId);
  const selectedMarketId = useGame((s) => s.selectedMarketId);
  const myTurn = Boolean(state.me?.isMyTurn);

  return (
    <>
      {/* Round and pick live in the status bar; repeating them here only cost height. */}
      <div className="turn-board">
        <span className="eyebrow">턴 순서</span>
        <TurnTrack state={state} />
      </div>

      <section className="panel table-panel">
        <TableCanvas />
        <HandFallback state={state} />
      </section>

      {myTurn && selectedCardId && (
        <section className="panel confirm-panel">
          <p>
            {selectedMarketId
              ? '선택한 손패 카드를 시장에 놓고, 시장 카드를 가져옵니다.'
              : '선택한 카드를 내 플레이 영역에 놓습니다.'}
          </p>
          <div className="actions">
            <button type="button" onClick={actions.submitPick}>이 카드로 결정</button>
            <button type="button" className="secondary" onClick={actions.clearPick}>선택 취소</button>
          </div>
        </section>
      )}
    </>
  );
}
