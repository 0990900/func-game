/**
 * The secret goals.
 *
 * Three defects were carried through the port deliberately, to be fixed once
 * the behaviour had been proven equivalent: goals dealt by an index that
 * wrapped, `*` counted as an operation, and judging by a chain of id
 * comparisons that returned zero for anything it did not recognise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../src/core/commands.ts';
import { goalCheck, goals, judge } from '../src/core/goals.ts';
import { goalScore } from '../src/core/rules.ts';
import { createTable } from '../src/core/testing.ts';
import type { Card, ContainerName, GoalId } from '../src/core/types.ts';

const real = (container: ContainerName, operation: string): Card => ({
  id: `${container}.${operation}`,
  kind: 'container-function',
  container,
  operation,
  label: `${container}.${operation}`,
});
const utility = (operation: string): Card =>
  ({ id: operation, kind: 'utility', container: null, operation, label: operation });
const universal: Card = { id: 'w', kind: 'wildcard', container: '*', operation: '*', label: '*.*' };

const goalById = (id: string) => goals.find((goal) => goal.id === id)!;

test('a joker is not an operation', () => {
  const eight = ['map', 'ap', 'pure', 'chain', 'alt', 'zero', 'filter', 'reduce']
    .map((op) => real('Maybe', op));
  const collector = goalById('collector');

  assert.equal(goalScore({ playArea: eight, goal: collector }), 0, '여덟 종류로는 아직입니다');
  assert.equal(
    goalScore({ playArea: [...eight, universal], goal: collector }),
    0,
    '조커는 어떤 연산도 대신할 수 있을 뿐, 아홉 번째 연산이 아닙니다',
  );
  assert.equal(
    goalScore({ playArea: [...eight, real('Either', 'bimap')], goal: collector }),
    collector.score,
    '진짜 아홉 번째 연산이면 달성됩니다',
  );
});

test('Purist asks for printed cards and jokers do not answer', () => {
  const jokers = Array.from({ length: 4 }, (_, i) => ({ ...universal, id: `w${i}` }));
  assert.equal(goalScore({ playArea: jokers, goal: goalById('purist') }), 0, '조커로는 안 됩니다');

  const printed = ['map', 'ap'].map((op) => real('List', op));
  assert.equal(goalScore({ playArea: printed, goal: goalById('purist') }), goalById('purist').score);
});

test('every goal can be met', () => {
  // A goal that cannot be reached is a goal that quietly pays nothing, which is
  // exactly what the id chain used to do to a goal it had never heard of.
  const reachable: Record<string, readonly Card[]> = {
    // Six combos in one container: Functor, Apply, Applicative, Chain, Monad, Alt.
    specialist: ['map', 'ap', 'pure', 'chain', 'alt'].map((op) => real('List', op)),
    generalist: (['Maybe', 'Either', 'List', 'Task'] as const).map((c) => real(c, 'map')),
    purist: ['map', 'ap'].map((op) => real('Task', op)),
    'utility-belt': ['curry', 'flip', 'compose'].map(utility),
    // Four kinds off the ladder: Alt, Plus, Filterable, Foldable.
    polyglot: ['map', 'alt', 'zero', 'filter', 'reduce'].map((op) => real('Maybe', op)),
    collector: ['map', 'ap', 'pure', 'chain', 'alt', 'zero', 'filter', 'reduce'].map((op) => real('Maybe', op))
      .concat(real('Either', 'bimap')),
  };

  for (const goal of goals) {
    const playArea = reachable[goal.id];
    assert.ok(playArea, `${goal.id}: 달성 방법을 아무도 모릅니다`);
    assert.equal(goalScore({ playArea: [...playArea], goal }), goal.score, `${goal.id}: 달성했는데 0점입니다`);
    assert.equal(judge(goal.id)!.met(goalCheck([])), false, `${goal.id}: 빈 판으로도 달성됩니다`);
  }
});

test('a goal nobody can judge is an error, not a zero', () => {
  assert.throws(
    () => goalScore({ playArea: [], goal: { id: 'nonesuch' as GoalId, name: '?', text: '?', score: 99, unit: '?' } }),
    /판정할 수 없는 목표/,
  );
});

test('every seat chooses between two different goals', () => {
  // Four seats need eight goals to be dealt disjoint pairs and there are six,
  // so the index used to wrap and hand the fourth seat the first seat's pair —
  // every game, not sometimes.
  let identicalPairs = 0;

  for (let seed = 1; seed <= 60; seed += 1) {
    const table = createTable('A', seed);
    for (const name of ['B', 'C', 'D']) table.run(Command.joinRoom(name));
    table.run(Command.startGame(table.room.hostPlayerId));

    for (const player of table.room.players) {
      assert.equal(player.goalOptions.length, 2);
      assert.notEqual(player.goalOptions[0]!.id, player.goalOptions[1]!.id, '같은 목표를 두 장 받았습니다');
    }

    const pairs = table.room.players.map((p) => [...p.goalOptions].map((g) => g.id).sort().join('+'));
    if (pairs[0] === pairs[3]) identicalPairs += 1;
  }

  // Overlap is allowed — a goal is not exclusive — but it has to be chance.
  assert.ok(identicalPairs < 20, `1번과 4번이 60판 중 ${identicalPairs}판에서 같았습니다`);
});
