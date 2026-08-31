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

/**
 * Utility pays for variety, and the first one has to pay something.
 *
 * The curve used to open at zero: a first `map` stood up a 2-point Functor on
 * the spot, while a first utility bought nothing at all and only promised to
 * matter later. Nobody opened a utility line — bots were watched declining
 * utilities from a market until the market held nothing else — and the cards
 * sat there, plentiful and worthless, because the market only turns over when
 * somebody trades. One point across the whole curve keeps the commitment (a
 * first utility is still worth half a Functor) and removes the refusal.
 */
export function scoreUtilities(cards: readonly Card[]): UtilityScore {
  const n = utilityOperations(cards).size;
  let diversity = 0;
  if (n === 1) diversity = 1;
  else if (n === 2) diversity = 2;
  else if (n === 3) diversity = 5;
  else if (n === 4) diversity = 8;
  else if (n === 5) diversity = 12;
  else if (n === 6) diversity = 17;
  else if (n >= 7) diversity = 17 + (n - 6) * 4;

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
