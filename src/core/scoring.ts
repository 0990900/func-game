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
