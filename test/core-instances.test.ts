/**
 * Holding one operation across containers.
 *
 * Combos read along a container — everything Maybe can do. This is the other
 * direction: `map` for Maybe and Either and List and Task is not four unrelated
 * cards, it is one interface written four times, which is what a typeclass is.
 * The board had rows worth points and columns worth nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreInstances, instanceScore, scorePlayer } from '../src/core/scoring.ts';
import { createDeck } from '../src/core/cards.ts';
import type { Card, ContainerName } from '../src/core/types.ts';

const deck = createDeck();
const real = (container: ContainerName, operation: string): Card => {
  const card = deck.find((c) =>
    c.kind === 'container-function' && c.container === container && c.operation === operation);
  assert.ok(card, `${container}.${operation} 카드가 덱에 없습니다`);
  return card;
};
const wild = (operation: string): Card => {
  const card = deck.find((c) => c.kind === 'operation-wildcard' && c.operation === operation);
  assert.ok(card, `*.${operation} 카드가 덱에 없습니다`);
  return card;
};

test('one container is not a column', () => {
  assert.equal(instanceScore([real('Maybe', 'map')]), 0);
  assert.equal(scoreInstances([real('Maybe', 'map')]).length, 0);
});

test('a column pays 2, 5 and 9 as it fills', () => {
  const maps: Card[] = [];
  const paid: number[] = [];
  for (const container of ['Maybe', 'Either', 'List', 'Task'] as const) {
    maps.push(real(container, 'map'));
    paid.push(instanceScore(maps));
  }
  assert.deepEqual(paid, [0, 2, 5, 9]);
});

test('the length of the column does not change the price', () => {
  // `zero` exists for two containers, `map` for four. Two of each pays the same:
  // the score is on how many you hold, not on how far there was to go.
  const zeroes = [real('Maybe', 'zero'), real('List', 'zero')];
  const maps = [real('Maybe', 'map'), real('Either', 'map')];
  assert.equal(instanceScore(zeroes), 2);
  assert.equal(instanceScore(maps), 2);
});

test('bimap is no column at all', () => {
  // Only Either has a second slot to map, so one card would finish it — which
  // is no achievement. It is left out of the count entirely.
  const rows = scoreInstances([real('Either', 'bimap'), real('Either', 'map'), real('Maybe', 'map')]);
  assert.equal(rows.some((row) => row.operation === 'bimap'), false);
  assert.equal(instanceScore([real('Either', 'bimap')]), 0);
});

test('a wildcard covers the slot but does not fill the column', () => {
  // `*.map` stands in for every container's map at once, so counting it would
  // make one card a finished column. A stand-in is not an instance you wrote.
  const printed = [real('Maybe', 'map'), real('Either', 'map')];
  assert.equal(instanceScore(printed), 2);
  assert.equal(instanceScore([...printed, wild('map')]), 2, '조커가 열을 채웠습니다');
});

test('a column never reaches past the containers that have the operation', () => {
  // Task hands its value to nobody, so `reduce` reaches three containers and
  // three is the whole column.
  const rows = scoreInstances([real('Maybe', 'reduce'), real('Either', 'reduce'), real('List', 'reduce')]);
  const reduce = rows.find((row) => row.operation === 'reduce');
  assert.ok(reduce);
  assert.deepEqual([...reduce.possible].sort(), ['Either', 'List', 'Maybe']);
  assert.equal(reduce.score, 5, '세 칸이 그 열의 전부입니다');
});

test('the total carries it', () => {
  const playArea = [real('Maybe', 'map'), real('Either', 'map'), real('List', 'map')];
  const score = scorePlayer({ playArea, claimGroups: [] });
  assert.equal(score.instanceScore, 5);
  assert.equal(score.total, score.comboScore + score.utilityScore + score.claimScore + score.instanceScore);
});
