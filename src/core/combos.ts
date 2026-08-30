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

interface Resources {
  readonly exact: ReadonlySet<string>;
  readonly operationWildcards: readonly string[];
  readonly containerWildcards: number;
  readonly universalWildcards: number;
}

function resources(cards: readonly Card[], container: ContainerName): Resources {
  const exact = new Set<string>();
  const operationWildcards: string[] = [];
  let containerWildcards = 0;
  let universalWildcards = 0;

  for (const card of cards) {
    if (card.kind === 'container-function' && card.container === container) exact.add(card.operation);
    else if (card.kind === 'operation-wildcard') operationWildcards.push(card.operation);
    else if (card.kind === 'container-wildcard' && card.container === container) containerWildcards += 1;
    else if (card.kind === 'wildcard') universalWildcards += 1;
  }
  return { exact, operationWildcards, containerWildcards, universalWildcards };
}

/**
 * Which of `requires` this play area can supply for `container`, spending each
 * card on at most one slot: an exact card first, then an operation wildcard for
 * that operation, then any free wildcard.
 *
 * The UI's combo hints read this, so a slot shown as covered is a slot the
 * rules agree is covered.
 */
export function coveredOperations(
  cards: readonly Card[],
  container: ContainerName,
  requires: readonly string[],
): Set<string> {
  const r = resources(cards, container);
  const opWilds = [...r.operationWildcards];
  let freeWilds = r.containerWildcards + r.universalWildcards;
  const covered = new Set<string>();

  for (const op of requires) {
    if (r.exact.has(op)) {
      covered.add(op);
      continue;
    }
    const opIndex = opWilds.indexOf(op);
    if (opIndex >= 0) {
      opWilds.splice(opIndex, 1);
      covered.add(op);
      continue;
    }
    if (freeWilds > 0) {
      freeWilds -= 1;
      covered.add(op);
    }
  }
  return covered;
}

export function canBuild(cards: readonly Card[], container: ContainerName, requires: readonly string[]): boolean {
  return coveredOperations(cards, container, requires).size === requires.length;
}

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
  return cards.some((card) =>
    card.kind === 'container-function'
    && card.container === container
    && requires.includes(card.operation));
}

/** The combos in this play area that may be claimed. */
export function claimableCombos(cards: readonly Card[]): Combo[] {
  return findCombos(cards).filter((combo) => isClaimable(cards, combo.container, combo.requires));
}

export function findCombos(cards: readonly Card[]): Combo[] {
  const found: Combo[] = [];
  for (const def of comboDefinitions) {
    for (const container of def.containers) {
      if (canBuild(cards, container, def.requires)) found.push({ ...def, container });
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
