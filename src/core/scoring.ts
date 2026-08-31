import { scoringCombos } from './combos.ts';
import { createDeck } from './cards.ts';
import type { Card, Combo, ContainerName, InstanceRow, Player, ScoreBreakdown } from './types.ts';

export interface UtilityScore {
  readonly diversity: number;
  readonly total: number;
  readonly count: number;
}

/** The distinct utility operations held. Utility scores on this count alone. */
export const utilityOperations = (cards: readonly Card[]): ReadonlySet<string> =>
  new Set(cards.filter((card) => card.kind === 'utility').map((card) => card.operation));

/**
 * Utility pays for variety, and it has to pay enough to be worth a turn.
 *
 * Every kind after the first is worth one more than the last: 2, then +3, +4,
 * +5, +6, +7. Committing is what pays, and the first card still opens level
 * with a Functor so nobody has to lose a turn to get started.
 *
 * The old curve was flat and slight — 1, 2, 5, 8 — and it was written when a
 * container card bought a 2-point Functor and nothing else. Since then the
 * ladder branched into thirteen combos and holding one operation across
 * containers began paying on top, so a container card came to be worth 4 or 5
 * while a utility stayed at 1. Bots stopped taking them at all: the market ran
 * with 2.7 of its 4 slots stuck on utilities nobody would trade for, and a
 * quarter of all players finished having never held one. At this curve the
 * market clears to 0.65 and the share of players holding three kinds or more
 * goes from 18% to 33%.
 */
const UTILITY_CURVE = [0, 2, 5, 9, 14, 20, 27] as const;

export function scoreUtilities(cards: readonly Card[]): UtilityScore {
  const n = utilityOperations(cards).size;
  const last = UTILITY_CURVE.length - 1;
  // The kth kind is worth k + 1, which is what the table spells out; past the
  // end of the table the same rule simply carries on.
  let diversity = UTILITY_CURVE[Math.min(n, last)]!;
  for (let k = last + 1; k <= n; k += 1) diversity += k + 1;

  return { diversity, total: diversity, count: n };
}

/**
 * Which operations exist for more than one container, and where.
 *
 * `bimap` is left out: only Either has a second slot to map, so a single card
 * would be a finished column, which is no achievement at all.
 */
const columns: ReadonlyArray<{ operation: string; possible: readonly ContainerName[] }> = (() => {
  const seen = new Map<string, ContainerName[]>();
  for (const card of createDeck()) {
    if (card.kind !== 'container-function' || card.container === '*' || card.container === null) continue;
    const list = seen.get(card.operation) ?? [];
    if (!list.includes(card.container)) list.push(card.container);
    seen.set(card.operation, list);
  }
  return [...seen]
    .filter(([, possible]) => possible.length >= 2)
    .map(([operation, possible]) => ({ operation, possible }));
})();

/** What holding one operation in n containers pays. */
const acrossPrice = [0, 0, 2, 5, 9] as const;

/**
 * Holding the same operation across containers.
 *
 * Combos read along a container — everything Maybe can do. This reads the other
 * way: `map` for Maybe AND Either AND List AND Task is not four unrelated cards,
 * it is one interface implemented four times, which is the whole idea of a
 * typeclass. The board has rows worth points and, until now, columns worth
 * nothing.
 *
 * Printed cards only. A `*.map` covers every container's map at once, so
 * counting wildcards would make one card a finished column — and a wildcard
 * standing in for an instance is not the same as having written it, which is
 * the distinction Purist and Polyglot already turn on.
 */
export function scoreInstances(cards: readonly Card[]): readonly InstanceRow[] {
  const rows: InstanceRow[] = [];
  for (const { operation, possible } of columns) {
    const held = possible.filter((container) => cards.some((card) =>
      card.kind === 'container-function'
      && card.container === container
      && card.operation === operation));
    if (held.length < 2) continue;
    rows.push({ operation, possible, held, score: acrossPrice[held.length] ?? 9 });
  }
  return rows;
}

export const instanceScore = (cards: readonly Card[]): number =>
  scoreInstances(cards).reduce((sum, row) => sum + row.score, 0);

export interface PlayerScore extends ScoreBreakdown {
  readonly combos: readonly Combo[];
  readonly instances: readonly InstanceRow[];
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
  const instances = scoreInstances(player.playArea);
  const across = instances.reduce((sum, row) => sum + row.score, 0);
  return {
    combos,
    comboScore,
    instances,
    utilityScore: utilities.total,
    claimScore: claims,
    instanceScore: across,
    total: comboScore + utilities.total + claims + across,
  };
}
