/**
 * The bottom dock: the one part of the screen a thumb can always reach.
 *
 * Top row is the secret-goal chip, which never goes away. Bottom row holds
 * either the four reference triggers or the pick confirmation — they replace
 * each other rather than stack, so the dock's height never moves the table.
 *
 * The triggers stay labeled and visible rather than collapsing into one menu:
 * with four or fewer destinations, hiding them behind a menu measurably costs
 * discovery, and there is no shortage of room for four.
 */
import { GoalProgress } from './GoalProgress.tsx';
import { actions, useGame } from '../store/gameStore.ts';
import type { Card, Goal, PublicMe } from '../../../src/core/types.ts';

export type SheetName = 'goal' | 'combos' | 'score' | 'log';

const TRIGGERS: ReadonlyArray<{ name: SheetName; label: string; icon: string }> = [
  { name: 'goal', label: '목표', icon: '🎯' },
  { name: 'combos', label: '조합', icon: '⬡' },
  { name: 'score', label: '점수', icon: '★' },
  { name: 'log', label: '기록', icon: '≡' },
];

export function Dock({
  goal,
  playArea,
  me,
  openSheet,
  onOpenSheet,
}: {
  readonly goal: Goal | null;
  readonly playArea: readonly Card[];
  readonly me: PublicMe | null;
  readonly openSheet: SheetName | null;
  readonly onOpenSheet: (sheet: SheetName | null) => void;
}) {
  const showSignatures = useGame((s) => s.showSignatures);
  const showOpponents = useGame((s) => s.showOpponents);
  const selectedCardId = useGame((s) => s.selectedCardId);
  const selectedMarketId = useGame((s) => s.selectedMarketId);
  const claiming = Boolean(me?.canFinishClaim);
  const deciding = Boolean(selectedCardId);

  return (
    <div className="dock">
      <GoalProgress goal={goal} playArea={playArea} onOpen={() => onOpenSheet('goal')} />

      {/* A finished combo stops the turn until it is resolved, so the choice
          takes the dock ahead of everything else. */}
      {claiming ? (
        <div className="dock-confirm dock-claim">
          <p>새 조합 완성 · Claim하면 1점 (게임 전체에서 한 번만)</p>
          <div className="dock-actions dock-actions--claims">
            {me!.availableClaims.map((combo) => (
              <button
                key={`${combo.container}:${combo.name}`}
                type="button"
                onClick={() => actions.claim(combo.container, combo.name)}
              >
                {combo.container} {combo.name}
              </button>
            ))}
            <button type="button" className="secondary" onClick={actions.finishClaim}>
              건너뛰기
            </button>
          </div>
        </div>
      ) : deciding ? (
        <div className="dock-confirm">
          <p>
            {selectedMarketId ? '뽑은 카드를 시장에 놓고 교환합니다.' : '내 플레이 영역에 놓습니다.'}
          </p>
          <div className="dock-actions">
            <button type="button" onClick={actions.submitPick}>이 카드로 결정</button>
            <button
              type="button"
              className="secondary"
              onClick={actions.clearPick}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <nav className="dock-triggers" aria-label="참조 정보">
          {/* Turning the cards over is reference, not a move, so it lives with
              the other reference controls rather than beside the pick buttons. */}
          <button
            type="button"
            className={`dock-trigger${showSignatures ? ' is-open' : ''}`}
            aria-pressed={showSignatures}
            onClick={() => actions.toggleSignatures()}
          >
            <span aria-hidden="true">↻</span>
            수식
          </button>
          <button
            type="button"
            className={`dock-trigger${showOpponents ? ' is-open' : ''}`}
            aria-pressed={showOpponents}
            onClick={() => actions.toggleOpponents()}
          >
            <span aria-hidden="true">◎</span>
            상대
          </button>
          {TRIGGERS.map((trigger) => (
            <button
              key={trigger.name}
              type="button"
              className={`dock-trigger${openSheet === trigger.name ? ' is-open' : ''}`}
              aria-expanded={openSheet === trigger.name}
              onClick={() => onOpenSheet(openSheet === trigger.name ? null : trigger.name)}
            >
              <span aria-hidden="true">{trigger.icon}</span>
              {trigger.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
