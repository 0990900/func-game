/**
 * The secret goal, as one line that is always on screen.
 *
 * It is consulted on every single decision, which is exactly the kind of thing
 * that must not live behind a panel. Where the goal has a countable target the
 * chip shows progress against it, so the player does not have to re-read the
 * rule to know how far off they are.
 */
import { goalStanding } from '../../../src/core/goals.ts';
import type { Card, Goal } from '../../../src/core/types.ts';

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
