/**
 * The playing screen: a fixed three-row grid, not a scrolling document.
 *
 * status bar / table / dock. Nothing here scrolls — the only vertical scroller
 * in the app is a sheet's body, which is what keeps a scrolling canvas from
 * fighting a scrolling page.
 *
 * What stays on screen is what a player needs *while deciding*: the turn, their
 * hand and the market, their own play area, and the secret goal. What is
 * consulted *between* decisions — the combo reference, scores, the log, an
 * opponent's full board — is a tap away in a sheet.
 */
import { useState } from 'react';
import { TableCanvas } from '../pixi/TableCanvas.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { ComboGuide } from './ComboGuide.tsx';
import { Dock } from './Dock.tsx';
import type { SheetName } from './Dock.tsx';
import { eventIcon, scoreSummary, statusName } from '../theme/meta.ts';
import { actions, useGame } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

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

function ScoreSheet({ state }: { readonly state: PublicState }) {
  return (
    <ul className="score-list">
      {[...state.players]
        .sort((a, b) => b.publicScore.total - a.publicScore.total)
        .map((player) => (
          <li key={player.id} className={player.id === state.me?.id ? 'is-me' : undefined}>
            <b>{player.name}{player.bot ? ' (Bot)' : ''}</b>
            <span className="total">{player.publicScore.total}점</span>
            <span className="muted">{scoreSummary(player.publicScore)}</span>
            <span className="chips">
              {player.playArea.map((card) => (
                <span key={card.id} className="chip">{card.label}</span>
              ))}
              {player.playArea.length === 0 && <span className="muted">아직 없음</span>}
            </span>
          </li>
        ))}
    </ul>
  );
}

export function GameTable({ state }: { readonly state: PublicState }) {
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const selectedCardId = useGame((s) => s.selectedCardId);
  const mySeat = state.players.find((player) => player.id === state.me?.id);

  // Choosing a card is a decision; a panel covering the table would be in the
  // way. The combo guide is the exception — it is what you consult *to* decide,
  // so it stays and re-reads the selection instead of closing.
  if (selectedCardId && sheet && sheet !== 'combos') setSheet(null);

  const goal = state.me?.goal ?? null;
  const playArea = mySeat?.playArea ?? [];

  return (
    <>
      <div className="table-area">
        <TableCanvas />
        <HandFallback state={state} />
      </div>

      <Dock goal={goal} playArea={playArea} openSheet={sheet} onOpenSheet={setSheet} />

      {/* Non-modal: no scrim, the table stays live so cards can be tapped
          while the reference is open. */}
      <BottomSheet
        open={sheet === 'combos'}
        title="조합 가이드"
        modal={false}
        onClose={() => setSheet(null)}
      >
        <ComboGuide playArea={playArea} />
      </BottomSheet>

      <BottomSheet open={sheet === 'goal'} title="내 비밀 목표" onClose={() => setSheet(null)}>
        {goal ? (
          <>
            <b className="goal-name">{goal.name}</b>
            <p>{goal.text}</p>
            <p className="muted">달성하면 게임 종료 시 +{goal.score}점. 나만 볼 수 있습니다.</p>
          </>
        ) : (
          <p className="muted">아직 목표를 선택하지 않았습니다.</p>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === 'score'} title="점수와 플레이 영역" onClose={() => setSheet(null)}>
        <p className="muted">공개 점수입니다. 비밀 목표 점수는 게임이 끝나야 더해집니다.</p>
        <ScoreSheet state={state} />
      </BottomSheet>

      <BottomSheet open={sheet === 'log'} title="진행 기록" onClose={() => setSheet(null)}>
        <ul className="event-log">
          {state.events.map((event) => (
            <li key={event.id}>
              <span aria-hidden="true">{eventIcon(event.type)}</span>
              {event.message}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}

export { statusName };
