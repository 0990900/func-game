/**
 * Bots play toward the goal they are holding.
 *
 * They used to ignore it entirely — the valuation never mentioned `goal` — so
 * being dealt Specialist rather than Polyglot changed nothing a bot did, and a
 * goal was only ever met by accident. Measured that way Specialist came up 96%
 * of the time and Polyglot 0%, which described the accident rate and not the
 * goals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalWorth, CARDS_PER_PLAYER } from '../src/core/rules.ts';
import { judge, goalCheck, goals } from '../src/core/goals.ts';
import { createDeck } from '../src/core/cards.ts';
import { Command } from '../src/core/commands.ts';
import { createTable } from '../src/core/testing.ts';
import { scoreUtilities } from '../src/core/scoring.ts';
import type { Card, ContainerName } from '../src/core/types.ts';

const deck = createDeck();
const real = (container: ContainerName, operation: string): Card =>
  deck.find((c) => c.kind === 'container-function' && c.container === container && c.operation === operation)!;
const goalNamed = (id: string) => goals.find((goal) => goal.id === id)!;

function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

test('finishing every step is exactly what meeting the goal means', () => {
  // Progress is what a bot steers by and `met` is what pays. If they can drift
  // apart, a bot collects toward something that never scores.
  const playable = deck.filter((c) => c.kind !== 'order-reverse');
  for (let seed = 1; seed <= 200; seed += 1) {
    const playArea = shuffled(playable, seed).slice(0, 15);
    const check = goalCheck(playArea);
    for (const goal of goals) {
      const definition = judge(goal.id)!;
      assert.equal(
        definition.done(check) >= definition.steps,
        definition.met(check),
        `${goal.id}: 진행도와 달성 판정이 어긋납니다`,
      );
      assert.ok(definition.done(check) <= definition.steps, `${goal.id}: 진행도가 단계 수를 넘었습니다`);
    }
  }
});

test('a step toward the goal is worth something, a card beside it is not', () => {
  const player = {
    id: 'seat-1',
    goal: goalNamed('polyglot'),
    playArea: [real('Maybe', 'map'), real('Either', 'map'), real('List', 'map')],
  };
  // The fourth container's map is the last step Polyglot is waiting for.
  assert.ok(goalWorth(real('Task', 'map'), player) > 0, '목표를 진행시키는 카드가 0점입니다');
  // Maybe.ap is a fine card and does nothing at all for this goal.
  assert.equal(goalWorth(real('Maybe', 'ap'), player), 0);
});

test('a goal out of reach pulls nothing', () => {
  // One turn left and three containers still missing: chasing it now can only
  // cost the bot the points it could still score.
  const player = {
    id: 'seat-1',
    goal: goalNamed('polyglot'),
    playArea: [
      real('Maybe', 'map'),
      ...Array.from({ length: CARDS_PER_PLAYER - 2 }, (_, i) => real('Maybe', ['ap', 'pure', 'chain'][i % 3]!)),
    ],
  };
  assert.equal(player.playArea.length, CARDS_PER_PLAYER - 1, '마지막 한 장을 남긴 상태여야 합니다');
  assert.equal(goalWorth(real('Either', 'map'), player), 0, '닿을 수 없는 목표가 값을 가졌습니다');
});

test('two seats holding the same goal do not play it identically', () => {
  const playArea = [real('Maybe', 'map'), real('Either', 'map'), real('List', 'map')];
  const card = real('Task', 'map');
  const worth = (id: string): number => goalWorth(card, { id, goal: goalNamed('polyglot'), playArea });
  const seats = ['player-1', 'player-2', 'player-3', 'player-4'].map(worth);
  assert.equal(new Set(seats).size > 1, true, '모든 자리가 목표를 똑같은 무게로 봅니다');
  for (const value of seats) assert.ok(value > 0, '어떤 자리는 목표를 아예 무시합니다');
  // And a seat is steady: the same seat weighs it the same every time.
  assert.equal(worth('player-1'), worth('player-1'));
});

test('a bot dealt Utility Belt ends up with more utility kinds', () => {
  const kinds = (id: string): number => {
    let total = 0;
    let bots = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const table = createTable('나', seed);
      table.run(Command.startGame(table.room.hostPlayerId));
      for (const player of table.room.players) {
        if (player.bot) player.goal = goalNamed(id);
        else if (!player.goal) table.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
      }
      while (table.room.phase === 'draft') {
        const current = table.room.players[table.room.currentPlayerIndex]!;
        if (current.bot) table.run(Command.botTurn(current.id));
        else table.run(Command.pick(current.id, table.room.drawn!.id, null));
      }
      for (const player of table.room.players) {
        if (!player.bot) continue;
        total += scoreUtilities(player.playArea).count;
        bots += 1;
      }
    }
    return total / bots;
  };

  const chasing = kinds('utility-belt');
  const elsewhere = kinds('purist');
  assert.ok(
    chasing > elsewhere,
    `Utility Belt를 받은 봇이 ${chasing.toFixed(2)}종, Purist를 받은 봇이 ${elsewhere.toFixed(2)}종 — 목표가 행동을 바꾸지 못했습니다`,
  );
});
