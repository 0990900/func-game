import { containers } from './cards.ts';
import type { Card, Combo, ComboDefinition, ContainerName } from './types.ts';

export const comboDefinitions: readonly ComboDefinition[] = [
  { name: 'Functor', family: 'base', score: 2, containers, requires: ['map'] },
  { name: 'Apply', family: 'base', score: 4, containers, requires: ['map', 'ap'] },
  { name: 'Applicative', family: 'base', score: 6, containers, requires: ['map', 'ap', 'pure'] },
  { name: 'Monad', family: 'base', score: 9, containers, requires: ['map', 'ap', 'pure', 'chain'] },
  { name: 'Alternative', family: 'special', score: 11, containers: ['Maybe'], requires: ['map', 'ap', 'pure', 'alt', 'zero'] },
  { name: 'Bifunctor', family: 'special', score: 6, containers: ['Either'], requires: ['map', 'bimap'] },
  { name: 'Foldable', family: 'special', score: 6, containers: ['List'], requires: ['map', 'reduce'] },
  { name: 'Traversable', family: 'special', score: 10, containers: ['List'], requires: ['map', 'reduce', 'traverse'] },
];

/** One filled slot, as `Container:operation` — `Maybe:map`. */
const slot = (container: ContainerName, operation: string): string => `${container}:${operation}`;

/**
 * Every slot a play area supplies, wildcards already assigned.
 *
 * A wildcard stands for ONE operation — that is the limit. Every slot it fills
 * then behaves exactly like a real card and supports each combo needing it: an
 * assigned `ap` feeds Apply, Applicative and Monad alike, as the printed card
 * would. What it cannot do is be `chain` here and `traverse` there.
 */
export type Coverage = ReadonlySet<string>;

const isWildcard = (card: Card): boolean =>
  card.kind === 'operation-wildcard' || card.kind === 'container-wildcard' || card.kind === 'wildcard';

/** Narrowest first, so a universal joker is spent only when nothing else fits. */
const reach = (card: Card): number =>
  card.kind === 'operation-wildcard' ? 0 : card.kind === 'container-wildcard' ? 1 : 2;

const fits = (card: Card, container: ContainerName, operation: string): boolean =>
  card.kind === 'operation-wildcard' ? card.operation === operation
    : card.kind === 'container-wildcard' ? card.container === container
      : card.kind === 'wildcard';

/** What a coverage is worth: the top base rung per container, plus every special. */
function coverageScore(covered: Coverage): number {
  let total = 0;
  for (const container of containers) {
    let base = 0;
    for (const definition of comboDefinitions) {
      if (!definition.containers.includes(container)) continue;
      if (!definition.requires.every((operation) => covered.has(slot(container, operation)))) continue;
      if (definition.family === 'base') base = Math.max(base, definition.score);
      else total += definition.score;
    }
    total += base;
  }
  return total;
}

/** Every slot a combo asks for, so a wildcard is never spent somewhere useless. */
const slotsWorthFilling: ReadonlyArray<readonly [ContainerName, string]> = (() => {
  const seen = new Set<string>();
  const list: Array<[ContainerName, string]> = [];
  for (const definition of comboDefinitions) {
    for (const container of definition.containers) {
      for (const operation of definition.requires) {
        const key = slot(container, operation);
        if (seen.has(key)) continue;
        seen.add(key);
        list.push([container, operation]);
      }
    }
  }
  return list;
})();

/**
 * Assigns the wildcards once, for the whole play area.
 *
 * Each combo used to be judged with its own fresh pool, so a single `*.*`
 * counted as Maybe.chain AND Either.map AND List.traverse at the same time —
 * one card being several different operations. A wildcard now settles on ONE
 * operation and stays there.
 *
 * Where it applies is decided by the blank on the card. `*.map` and `*.*` leave
 * the container blank, so their operation lands in all four containers at once;
 * `Maybe.*` has its container printed and serves Maybe alone. Four Functors off
 * one `*.map` is a big turn, and that is the point — a card game nobody wants to
 * play teaches nothing. The `*.*` already carries its own brake: a combo held up
 * only by wildcards scores but cannot be claimed.
 *
 * Which operation each wildcard settles on is the game's choice, not the
 * player's: **whatever arrangement scores the most.**
 */
export function allocateCoverage(cards: readonly Card[]): Coverage {
  const printed = new Set<string>();
  for (const card of cards) {
    // `container` is widened to include '*' and null for wildcards and utilities;
    // a container-function always names one of the four.
    if (card.kind === 'container-function' && card.container !== '*' && card.container !== null) {
      printed.add(slot(card.container, card.operation));
    }
  }

  // Ordered by what they are, never by when they were drawn, so the same cards
  // in a different order allocate the same way.
  const wildcards = cards.filter(isWildcard).sort((a, b) =>
    reach(a) - reach(b)
    || String(a.container).localeCompare(String(b.container))
    || a.operation.localeCompare(b.operation));
  if (wildcards.length === 0) return printed;

  const open = slotsWorthFilling.filter(([container, operation]) => !printed.has(slot(container, operation)));

  // Exhaustive, not greedy. A greedy pass takes the biggest gain available at
  // each step and can settle for a worse whole — which showed up as a printed
  // card LOWERING its owner's score, because the better arrangement it unlocked
  // was not the one greed walked into. Searching every arrangement also makes
  // the rule monotone for free: a real card only ever widens the choices, so the
  // best arrangement can never get worse.
  let bestScore = coverageScore(printed);
  let bestAssigned: string[] = [];
  const assigned: string[] = [];
  const seen = new Set<string>();

  const search = (index: number, covered: Set<string>): void => {
    const score = coverageScore(covered);
    if (score > bestScore) {
      bestScore = score;
      bestAssigned = [...assigned];
    }
    if (index >= wildcards.length) return;
    const card = wildcards[index]!;
    // Leaving a wildcard idle is a legal arrangement: nothing it can reach helps.
    search(index + 1, covered);
    for (const [container, operation] of open) {
      if (!fits(card, container, operation)) continue;
      // The blank on the card is what spreads. `*.map` and `*.*` leave the
      // container blank, so once the operation is settled they supply it in
      // every container at once — one card, four Functors. `Maybe.*` has its
      // container printed, so it serves Maybe and nowhere else.
      const filled = (card.container === '*'
        ? containers.map((c) => slot(c, operation))
        : [slot(container, operation)]
      ).filter((key) => !covered.has(key));
      if (filled.length === 0) continue;
      const memo = `${index + 1}|${[...assigned, ...filled].sort().join(',')}`;
      if (seen.has(memo)) continue;
      seen.add(memo);
      for (const key of filled) covered.add(key);
      assigned.push(...filled);
      search(index + 1, covered);
      for (let i = 0; i < filled.length; i += 1) assigned.pop();
      for (const key of filled) covered.delete(key);
    }
  };
  search(0, new Set(printed));

  const covered = new Set(printed);
  for (const key of bestAssigned) covered.add(key);
  return covered;
}

/**
 * Which of `requires` this play area supplies for `container`.
 *
 * The UI's combo hints read this, so a slot shown as covered is a slot the rules
 * agree is covered — including which combo a wildcard ended up serving.
 */
export function coveredOperations(
  cards: readonly Card[],
  container: ContainerName,
  requires: readonly string[],
): Set<string> {
  return coveredIn(allocateCoverage(cards), container, requires);
}

function coveredIn(covered: Coverage, container: ContainerName, requires: readonly string[]): Set<string> {
  return new Set(requires.filter((operation) => covered.has(slot(container, operation))));
}

export function canBuild(cards: readonly Card[], container: ContainerName, requires: readonly string[]): boolean {
  return builtIn(allocateCoverage(cards), container, requires);
}

const builtIn = (covered: Coverage, container: ContainerName, requires: readonly string[]): boolean =>
  requires.every((operation) => covered.has(slot(container, operation)));

/**
 * Whether a built combo may be claimed.
 *
 * Wildcards fill a slot but cannot carry a claim on their own: `*.*`, `*.map`
 * and `Either.*` are stand-ins, and a claim declares a combo you actually
 * assembled. At least one of the combo's required operations must come from a
 * real card of that container.
 *
 * Scoring is untouched — a combo held up by wildcards still pays its points. It
 * just cannot be declared, so it cannot be locked away from anyone else.
 */
export function isClaimable(cards: readonly Card[], container: ContainerName, requires: readonly string[]): boolean {
  if (!canBuild(cards, container, requires)) return false;
  return holdsReal(cards, container, requires);
}

const holdsReal = (cards: readonly Card[], container: ContainerName, requires: readonly string[]): boolean =>
  cards.some((card) =>
    card.kind === 'container-function'
    && card.container === container
    && requires.includes(card.operation));

/** The combos in this play area that may be claimed. */
export function claimableCombos(cards: readonly Card[]): Combo[] {
  return findCombos(cards).filter((combo) => holdsReal(cards, combo.container, combo.requires));
}

/** Every combo the area satisfies, all rungs included, under one wildcard assignment. */
export function findCombos(cards: readonly Card[]): Combo[] {
  const covered = allocateCoverage(cards);
  const found: Combo[] = [];
  for (const def of comboDefinitions) {
    for (const container of def.containers) {
      if (builtIn(covered, container, def.requires)) found.push({ ...def, container });
    }
  }
  return found;
}

export function scoringCombos(cards: readonly Card[]): Combo[] {
  const found = findCombos(cards);
  const scored: Combo[] = [];

  for (const container of containers) {
    const base = found
      .filter((c) => c.container === container && c.family === 'base')
      .sort((a, b) => b.score - a.score)[0];
    if (base) scored.push(base);
  }

  scored.push(...found.filter((c) => c.family === 'special'));
  return scored;
}

export function comboKey(combo: Pick<Combo, 'container' | 'name'>): string {
  return `${combo.container}:${combo.name}`;
}
