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
import { Dock } from './Dock.tsx';
import type { SheetName } from './Dock.tsx';
import { eventIcon, scoreSummary, statusName } from '../theme/meta.ts';
import { actions, useGame } from '../store/gameStore.ts';
import { useIsNarrow } from '../ui/useIsNarrow.ts';
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
              `${card.label}${previewed ? ' · 미리보기 중, 다시 누르면 선택' : ''}`
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
    </>
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

  // Escape backs out of one thing at a time: an open sheet first, since that is
  // what the player just opened, and only then the card they were holding.
  // A sheet closes itself, so this only has to cover the card.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || sheet) return;
      actions.clearPick();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sheet]);

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
