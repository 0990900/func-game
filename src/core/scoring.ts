import { scoringCombos } from './combos.ts';
import type { Card, Combo, Player, ScoreBreakdown } from './types.ts';

export interface UtilityScore {
  readonly diversity: number;
  readonly total: number;
  readonly count: number;
}

/** The distinct utility operations held. Utility scores on this count alone. */
export const utilityOperations = (cards: readonly Card[]): ReadonlySet<string> =>
  new Set(cards.filter((card) => card.kind === 'utility').map((card) => card.operation));

export function scoreUtilities(cards: readonly Card[]): UtilityScore {
  const n = utilityOperations(cards).size;
  let diversity = 0;
  if (n === 2) diversity = 1;
  else if (n === 3) diversity = 4;
  else if (n === 4) diversity = 7;
  else if (n === 5) diversity = 11;
  else if (n === 6) diversity = 16;
  else if (n >= 7) diversity = 16 + (n - 6) * 4;

  return { diversity, total: diversity, count: n };
}

export interface PlayerScore extends ScoreBreakdown {
  readonly combos: readonly Combo[];
}

export function scorePlayer(player: Pick<Player, 'playArea' | 'claimPoints'>): PlayerScore {
  const combos = scoringCombos(player.playArea);
  const comboScore = combos.reduce((sum, combo) => sum + combo.score, 0);
  const utilities = scoreUtilities(player.playArea);
  const claimScore = player.claimPoints;
  return {
    combos,
    comboScore,
    utilityScore: utilities.total,
    claimScore,
    total: comboScore + utilities.total + claimScore,
  };
}
