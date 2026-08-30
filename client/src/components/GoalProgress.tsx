/**
 * The secret goal, as one line that is always on screen.
 *
 * It is consulted on every single decision, which is exactly the kind of thing
 * that must not live behind a panel. Where the goal has a countable target the
 * chip shows progress against it, so the player does not have to re-read the
 * rule to know how far off they are.
 */
import { comboDefinitions, coveredOperations, findCombos } from '../../../src/core/combos.ts';
import { containers } from '../../../src/core/cards.ts';
import { scoreUtilities } from '../../../src/core/scoring.ts';
import type { Card, Goal } from '../../../src/core/types.ts';

const MONAD = comboDefinitions.find((combo) => combo.name === 'Monad')!;

export interface GoalStanding {
  readonly label: string;
  readonly met: boolean;
}

/**
 * Progress towards `goal`. The wording mirrors the goal's own rule, and the
 * counts come from the same functions that score it, so the chip cannot claim
 * something the rules disagree with.
 */
export function goalStanding(goal: Goal, playArea: readonly Card[]): GoalStanding {
  const combos = findCombos(playArea);
  const has = (container: string, operation: string): boolean =>
    playArea.some((card) => card.kind === 'container-function'
      && card.container === container && card.operation === operation);

  switch (goal.id) {
    case 'specialist': {
      const perContainer = containers.map((container) =>
        combos.filter((combo) => combo.container === container).length);
      const best = Math.max(0, ...perContainer);
      return { label: `한 컨테이너 조합 ${Math.min(best, 2)}/2`, met: best >= 2 };
    }
    case 'generalist': {
      const spread = new Set(combos.map((combo) => combo.container)).size;
      return { label: `컨테이너 ${Math.min(spread, 3)}/3`, met: spread >= 3 };
    }
    case 'purist': {
      const best = Math.max(0, ...containers.map((container) =>
        MONAD.requires.filter((operation) => has(container, operation)).length));
      return { label: `조커 없는 Monad ${best}/4`, met: best >= 4 };
    }
    case 'utility-belt': {
      const count = scoreUtilities(playArea).count;
      return { label: `Utility ${Math.min(count, 5)}/5`, met: count >= 5 };
    }
    case 'polyglot': {
      const maps = containers.filter((container) =>
        coveredOperations(playArea, container, ['map']).size === 1).length;
      return { label: `map 확보 ${maps}/4`, met: maps >= 4 };
    }
    case 'collector': {
      const kinds = new Set(playArea.filter((card) => card.operation).map((card) => card.operation)).size;
      return { label: `연산 종류 ${Math.min(kinds, 7)}/7`, met: kinds >= 7 };
    }
  }
}

export function GoalProgress({
  goal,
  playArea,
  onOpen,
}: {
  readonly goal: Goal | null;
  readonly playArea: readonly Card[];
  readonly onOpen: () => void;
}) {
  if (!goal) return null;
  const standing = goalStanding(goal, playArea);

  return (
    <button
      type="button"
      className={`goal-chip${standing.met ? ' is-met' : ''}`}
      onClick={onOpen}
      aria-label={`내 비밀 목표 ${goal.name}. ${standing.label}. 자세히 보기`}
    >
      <span aria-hidden="true">🎯</span>
      <b>{goal.name}</b>
      <span className="goal-chip-progress">{standing.label}</span>
      {standing.met && <span className="goal-chip-met">+{goal.score}</span>}
    </button>
  );
}
