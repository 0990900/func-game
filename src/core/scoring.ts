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

/**
 * What one turn's worth of claims pays: the nth combo declared together pays n.
 *
 * Finishing several at once is planning — holding `Maybe.ap` back until map,
 * pure, alt and zero are down completes three tiers on one card — so it is
 * worth more than finishing the same three apart.
 */
export const groupScore = (size: number): number => (size * (size + 1)) / 2;

/** Every claim this player has made, added up. */
export const claimScore = (groups: ReadonlyArray<readonly string[]>): number =>
  groups.reduce((sum, group) => sum + groupScore(group.length), 0);

export function scorePlayer(player: Pick<Player, 'playArea' | 'claimGroups'>): PlayerScore {
  const combos = scoringCombos(player.playArea);
  const comboScore = combos.reduce((sum, combo) => sum + combo.score, 0);
  const utilities = scoreUtilities(player.playArea);
  const claims = claimScore(player.claimGroups);
  return {
    combos,
    comboScore,
    utilityScore: utilities.total,
    claimScore: claims,
    total: comboScore + utilities.total + claims,
  };
}
