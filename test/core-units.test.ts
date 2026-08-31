import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/core/cards.ts';
import { canBuild, scoringCombos } from '../src/core/combos.ts';
import { scoreUtilities } from '../src/core/scoring.ts';
import type { Card, ContainerName } from '../src/core/types.ts';

const c = (container: ContainerName, operation: string, kind: Card['kind'] = 'container-function'): Card =>
  ({ id: `${container}.${operation}`, container, operation, kind, label: `${container}.${operation}` });

const utilityCards = (operations: readonly string[]): Card[] =>
  operations.map((operation) => ({ id: operation, kind: 'utility', container: null, operation, label: operation }));

test('deck contains exactly one *.*', () => {
  const deck = createDeck();
  assert.equal(deck.length, 67);
  assert.equal(deck.filter((card) => card.label === '*.*').length, 1);
});

test('Maybe Monad can be built from exact cards', () => {
  const cards = ['map', 'ap', 'pure', 'chain'].map((op) => c('Maybe', op));
  assert.equal(canBuild(cards, 'Maybe', ['map', 'ap', 'pure', 'chain']), true);
  assert.equal(scoringCombos(cards).find((x) => x.container === 'Maybe' && x.family === 'base')?.name, 'Monad');
});

test('operation wildcard fills matching operation', () => {
  const cards: Card[] = [
    c('Maybe', 'map'), c('Maybe', 'ap'), c('Maybe', 'pure'),
    { id: 'w1', kind: 'operation-wildcard', container: '*', operation: 'chain', label: '*.chain' },
  ];
  assert.equal(canBuild(cards, 'Maybe', ['map', 'ap', 'pure', 'chain']), true);
});

test('*.* fills any missing slot', () => {
  const cards: Card[] = [
    c('List', 'map'), c('List', 'reduce'),
    { id: 'w2', kind: 'wildcard', container: '*', operation: '*', label: '*.*' },
  ];
  assert.equal(canBuild(cards, 'List', ['map', 'reduce', 'traverse']), true);
});

test('utility scoring uses diversity only', () => {
  assert.deepEqual(scoreUtilities(utilityCards(['curry', 'uncurry'])), {
    diversity: 1,
    total: 1,
    count: 2,
  });
  assert.equal(scoreUtilities(utilityCards(['curry', 'uncurry', 'flip'])).total, 4);
  assert.equal(
    scoreUtilities(utilityCards(['curry', 'uncurry', 'flip', 'compose', 'pipe', 'identity', 'tap'])).total,
    20,
  );
});
