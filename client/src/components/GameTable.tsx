/**
 * The table: hand, market, play areas and turn track.
 *
 * This is the seam that becomes the Pixi canvas in milestone D. It is kept
 * free of chrome — no score panel, no event log, no dialogs — so swapping the
 * renderer is a local change. It reads only `PublicState` and the local
 * selection, and speaks only through store actions.
 */
import { Card } from './Card.tsx';
import { cardFace, cardTheme, statusName } from '../theme/meta.ts';
import { actions, useGame } from '../store/gameStore.ts';
import type { Card as CardModel, PublicPlayer, PublicState } from '../../../src/core/types.ts';

function Chips({ cards }: { readonly cards: readonly CardModel[] }) {
  if (cards.length === 0) {
    return (
      <span className="empty-state">
        <b>첫 카드를 기다리는 중</b>
        <span>손패에서 한 장을 선택하면 여기에 놓입니다.</span>
      </span>
    );
  }
  return (
    <>
      {cards.map((card) => (
        <span key={card.id} className={`chip card--${cardTheme(card)}`}>
          <b>{cardFace(card).containerSymbol}</b>
          {card.label}
        </span>
      ))}
    </>
  );
}

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

function OpponentArea({ player }: { readonly player: PublicPlayer }) {
  return (
    <div className="opponent">
      <div className="opponent-head">
        <b>{player.name}</b>
        {player.bot && <span className="pill">Bot</span>}
        <span className="pill">{statusName(player.status)}</span>
        <span className="score-pill">{player.publicScore.total}점</span>
      </div>
      <div className="chips">
        <Chips cards={player.playArea} />
      </div>
    </div>
  );
}

export function GameTable({ state }: { readonly state: PublicState }) {
  const selectedCardId = useGame((s) => s.selectedCardId);
  const selectedMarketId = useGame((s) => s.selectedMarketId);

  const me = state.me;
  const myTurn = Boolean(me?.isMyTurn);
  const mySeat = state.players.find((player) => player.id === me?.id);
  const opponents = state.players.filter((player) => player.id !== me?.id);

  return (
    <>
      <div className="turn-board">
        <div>
          <span className="eyebrow">턴 순서</span>
          <TurnTrack state={state} />
        </div>
        <div>
          <span className="eyebrow">진행</span>
          <b>
            Round {state.round}/{state.progress.roundsTotal} · Pick {state.pick}/{state.progress.picksPerRound}
          </b>
        </div>
      </div>

      <section className="panel">
        <h2>내 손패</h2>
        <div className="cards grid">
          {(me?.hand ?? []).map((card) => (
            <Card
              key={card.id}
              card={card}
              selected={card.id === selectedCardId}
              disabled={!myTurn}
              onClick={(picked) => actions.selectCard(picked.id)}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>시장</h2>
        <p className="muted">
          손패에서 한 장을 고른 뒤 시장 카드를 선택하면 교환합니다. 교환도 한 턴을 씁니다.
        </p>
        <div className="cards grid">
          {state.market.map((card) => (
            <Card
              key={card.id}
              card={card}
              selected={card.id === selectedMarketId}
              disabled={!myTurn || !selectedCardId}
              onClick={(picked) => actions.selectMarket(picked.id)}
            />
          ))}
        </div>
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

      <section className="panel">
        <h2>내 플레이 영역</h2>
        <div className="chips">
          <Chips cards={mySeat?.playArea ?? []} />
        </div>
      </section>

      <section className="panel">
        <h2>상대 플레이 영역</h2>
        {opponents.map((player) => <OpponentArea key={player.id} player={player} />)}
      </section>
    </>
  );
}
