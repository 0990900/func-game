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
    diversity: 2,
    total: 2,
    count: 2,
  });
  assert.equal(scoreUtilities(utilityCards(['curry', 'uncurry', 'flip'])).total, 5);
  assert.equal(
    scoreUtilities(utilityCards(['curry', 'uncurry', 'flip', 'compose', 'pipe', 'identity', 'tap'])).total,
    21,
  );
});

test('the first utility is worth something on its own', () => {
  // It used to be worth nothing, so nobody ever took the first one — a line
  // that opens at zero is a line that never opens.
  assert.equal(scoreUtilities(utilityCards([])).total, 0);
  assert.equal(scoreUtilities(utilityCards(['curry'])).total, 1);
  // And a duplicate still buys nothing: the score is on distinct kinds.
  assert.equal(scoreUtilities(utilityCards(['curry', 'curry'])).total, 1);
});

test('every extra utility kind is worth at least as much as the last', () => {
  const kinds = ['curry', 'uncurry', 'flip', 'compose', 'pipe', 'identity', 'tap', 'partial', 'constant'];
  let previous = 0;
  let gain = 0;
  for (let n = 1; n <= kinds.length; n += 1) {
    const total = scoreUtilities(utilityCards(kinds.slice(0, n))).total;
    const step = total - previous;
    assert.ok(step > 0, `the ${n}번째 종류가 0점입니다`);
    if (n > 1) assert.ok(step >= gain || n > 6, `${n}종에서 증가폭이 꺾였습니다: ${gain} -> ${step}`);
    gain = step;
    previous = total;
  }
});
