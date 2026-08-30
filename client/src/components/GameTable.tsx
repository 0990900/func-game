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
import { useEffect, useState } from 'react';
import { TableCanvas } from '../pixi/TableCanvas.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { ComboGuide } from './ComboGuide.tsx';
import { ScoreChart } from './ScoreChart.tsx';
import { Dock } from './Dock.tsx';
import type { SheetName } from './Dock.tsx';
import { eventIcon, scoreSummary, statusName } from '../theme/meta.ts';
import { actions, useGame } from '../store/gameStore.ts';
import { useIsNarrow } from '../ui/useIsNarrow.ts';
import { bindKeys } from '../ui/keyboard.ts';
import { comboDefinitions, coveredOperations, scoringCombos } from '../../../src/core/combos.ts';
import { cardBack } from '../theme/signatures.ts';
import type { Card, PublicState } from '../../../src/core/types.ts';

/**
 * The canvas cannot be read or focused, so every card on it is also a button
 * here — the market included, or a keyboard player could never make a swap.
 *
 * On a narrow screen a card takes two taps: the first previews it. That state
 * is announced rather than left silent, so a non-visual player can tell the
 * first press registered.
 */
function CardButtons({
  label,
  cards,
  selectedId,
  previewId,
  disabled,
  onSelect,
}: {
  readonly label: string;
  readonly cards: readonly Card[];
  readonly selectedId: string | null;
  readonly previewId: string | null;
  readonly disabled: boolean;
  readonly onSelect: (cardId: string) => void;
}) {
  if (cards.length === 0) return null;

  return (
    <div className="sr-hand">
      <h3 className="visually-hidden">{label}</h3>
      {cards.map((card) => {
        const chosen = card.id === selectedId;
        const previewed = card.id === previewId;
        return (
          <button
            key={card.id}
            type="button"
            className="sr-card"
            disabled={disabled}
            aria-pressed={chosen}
            aria-label={
              `${card.label} · ${cardBack(card).signature}`
              + `${previewed ? ' · 미리보기 중, 다시 누르면 선택' : ''}`
              + `${chosen ? ' · 선택됨' : ''}`
            }
            onClick={() => onSelect(card.id)}
          >
            {card.label}
          </button>
        );
      })}
    </div>
  );
}

function TableFallback({ state }: { readonly state: PublicState }) {
  const selectedCardId = useGame((s) => s.selectedCardId);
  const previewCardId = useGame((s) => s.previewCardId);
  const selectedMarketId = useGame((s) => s.selectedMarketId);
  const previewMarketId = useGame((s) => s.previewMarketId);
  const myTurn = Boolean(state.me?.isMyTurn);

  return (
    <>
      <CardButtons
        label="뽑은 카드 (키보드 선택)"
        cards={state.drawn ? [state.drawn] : []}
        selectedId={selectedCardId}
        previewId={previewCardId}
        disabled={!myTurn}
        onSelect={actions.selectCard}
      />
      <CardButtons
        label="시장 (뽑은 카드를 고른 뒤 교환할 카드 선택)"
        cards={state.market}
        selectedId={selectedMarketId}
        previewId={previewMarketId}
        disabled={!myTurn || !selectedCardId}
        onSelect={actions.selectMarket}
      />
      <TypeclassButtons state={state} />
    </>
  );
}

/**
 * The typeclass ladder, for anyone who cannot reach the canvas.
 *
 * On the table these are chips you tap to mark the operations a typeclass
 * needs. That was a canvas-only control, so a keyboard or screen-reader player
 * could neither read the ladder nor use the one feature the game exists to
 * teach. Here each is a button that says what it needs and how far this player
 * has got, which is the same answer the highlight gives visually.
 */
function TypeclassButtons({ state }: { readonly state: PublicState }) {
  const mine = state.players.find((player) => player.id === state.me?.id)?.playArea ?? [];
  const built = new Set(scoringCombos(mine).map((combo) => `${combo.container}:${combo.name}`));
  const claimed = new Set(state.players.flatMap((player) => player.claimGroups.flat()));

  return (
    <div className="sr-hand">
      <h3 className="visually-hidden">타입클래스</h3>
      {comboDefinitions.map((definition) => {
        const reached = definition.containers.filter((container) =>
          built.has(`${container}:${definition.name}`));
        const taken = definition.containers.filter((container) =>
          claimed.has(`${container}:${definition.name}`));
        const missing = definition.containers
          .map((container) => {
            const covered = coveredOperations(mine, container, definition.requires);
            const short = definition.requires.filter((operation) => !covered.has(operation));
            return short.length === 0 ? `${container} 완성` : `${container} ${short.join(' ')} 필요`;
          })
          .join(', ');

        return (
          <button
            key={definition.name}
            type="button"
            className="sr-card"
            aria-label={
              `${definition.name} ${definition.score}점 · 필요 ${definition.requires.join(' ')}`
              + ` · ${missing}`
              + `${reached.length ? ` · 확보 ${reached.length}곳` : ''}`
              + `${taken.length ? ` · Claim됨 ${taken.join(' ')}` : ''}`
            }
          >
            {definition.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The score, as it moved and as it stands.
 *
 * This used to list every card in every play area, which the table already
 * draws and draws better — the sheet was a second, worse copy of the board.
 * What the board cannot show is time: who led, when it changed hands, and
 * whether a total was climbing steadily or arrived in one claim.
 */
function ScoreSheet({ state }: { readonly state: PublicState }) {
  return (
    <>
      <ScoreChart state={state} />
      <ul className="score-list">
        {[...state.players]
          .sort((a, b) => b.publicScore.total - a.publicScore.total)
          .map((player, rank) => (
            <li key={player.id} className={player.id === state.me?.id ? 'is-me' : undefined}>
              <span className="rank" aria-label={`${rank + 1}위`}>{rank + 1}</span>
              <b>{player.name}{player.bot ? ' (Bot)' : ''}</b>
              <span className="total">{player.publicScore.total}점</span>
              <span className="muted">{scoreSummary(player.publicScore)}</span>
            </li>
          ))}
      </ul>
    </>
  );
}

export function GameTable({ state }: { readonly state: PublicState }) {
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const selectedCardId = useGame((s) => s.selectedCardId);
  // A sheet only covers the table on a narrow screen; wide, it is a side panel
  // sitting beside it, and calling that a modal dialog would be a lie.
  const narrow = useIsNarrow();
  const mySeat = state.players.find((player) => player.id === state.me?.id);

  // Choosing a card is a decision, and a panel over the table is in the way —
  // except the combo guide, which is what you consult *to* decide, so it stays
  // and re-reads the selection. Done in an effect: scheduling a render from
  // inside one is not something React promises to handle.
  useEffect(() => {
    if (narrow && selectedCardId && sheet && sheet !== 'combos') setSheet(null);
  }, [narrow, selectedCardId, sheet]);

  // Number keys pick cards and Escape backs out; both live in one place so
  // there is a single answer to what a key does.
  useEffect(bindKeys, []);

  const goal = state.me?.goal ?? null;
  const playArea = mySeat?.playArea ?? [];

  return (
    <>
      <div className="table-area">
        <TableCanvas />
        <TableFallback state={state} />
      </div>

      <Dock goal={goal} playArea={playArea} me={state.me} openSheet={sheet} onOpenSheet={setSheet} />

      {/* Non-modal: no scrim, the table stays live so cards can be tapped
          while the reference is open. */}
      <BottomSheet
        open={sheet === 'combos'}
        title="조합 가이드"
        modal={false}
        onClose={() => setSheet(null)}
      >
        <ComboGuide />
      </BottomSheet>

      <BottomSheet open={sheet === 'goal'} title="내 비밀 목표" modal={narrow} onClose={() => setSheet(null)}>
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

      <BottomSheet open={sheet === 'score'} title="점수와 플레이 영역" modal={narrow} onClose={() => setSheet(null)}>
        <p className="muted">공개 점수입니다. 비밀 목표 점수는 게임이 끝나야 더해집니다.</p>
        <ScoreSheet state={state} />
      </BottomSheet>

      <BottomSheet open={sheet === 'log'} title="진행 기록" modal={narrow} onClose={() => setSheet(null)}>
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
