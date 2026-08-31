/**
 * What a bot wants.
 *
 * The estimate this replaced valued a utility as `5 + how many utility cards
 * you hold` — cards, not kinds — so a second copy of one it already had looked
 * as good as a kind it was missing, and it never knew that the first utility
 * scores nothing while the sixth scores five.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../src/core/commands.ts';
import { createTable } from '../src/core/testing.ts';
import type { Card, ContainerName } from '../src/core/types.ts';
import type { Table as TestTable } from '../src/core/testing.ts';

const util = (operation: string): Card =>
  ({ id: `u-${operation}`, kind: 'utility', container: null, operation, label: operation });
const real = (container: ContainerName, operation: string): Card => ({
  id: `${container}.${operation}`,
  kind: 'container-function',
  container,
  operation,
  label: `${container}.${operation}`,
});

/** One bot turn with the market and the draw staged, returning what it took. */
function botTakes(held: readonly Card[], market: readonly Card[], drawn: Card): Card {
  const table: TestTable = createTable('나', 7);
  table.run(Command.startGame(table.room.hostPlayerId));
  for (const player of table.room.players) {
    if (!player.goal) table.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
  }

  const bot = table.room.players.find((player) => player.bot)!;
  bot.playArea = [...held];
  table.room.market = [...market];
  table.room.drawn = drawn;
  table.room.currentPlayerIndex = table.room.players.findIndex((p) => p.id === bot.id);
  table.room.phase = 'draft';
  table.run(Command.botTurn(bot.id));

  const after = table.room.players.find((player) => player.id === bot.id)!;
  return after.playArea[after.playArea.length - 1]!;
}

test('a bot that has started collecting utilities keeps going', () => {
  // Two kinds down, the next is worth three points — more than another card in
  // a container it has one of.
  const took = botTakes(
    [util('curry'), util('flip')],
    ['compose', 'pipe', 'identity', 'tap'].map(util),
    real('Task', 'chain'),
  );
  assert.equal(took.kind, 'utility', '유틸 2종을 가진 봇이 유틸을 마다했습니다');
});

test('a bot does not take a utility kind it already has', () => {
  // A duplicate adds nothing: utilities score on distinct kinds. The old
  // estimate would have valued this above the card it drew.
  const took = botTakes(
    [util('curry'), util('flip'), util('compose')],
    [util('curry'), util('flip')],
    real('Maybe', 'map'),
  );
  assert.equal(took.label, 'Maybe.map', '이미 가진 종류를 다시 집었습니다');
});

test('a bot finishes a combo rather than starting elsewhere', () => {
  // map, ap and pure down: chain turns Applicative into Monad, three points,
  // and no single card anywhere else pays that.
  const took = botTakes(
    ['map', 'ap', 'pure'].map((op) => real('List', op)),
    [real('List', 'chain'), util('curry'), util('flip'), real('Task', 'map')],
    real('Either', 'pure'),
  );
  assert.equal(took.label, 'List.chain');
});

test('a bot beats a player who never chooses', () => {
  // The human here always plays what it drew. A bot that swaps deliberately
  // should be ahead of that, or its choices are worth nothing.
  let bots = 0;
  let botScore = 0;
  let humans = 0;
  let humanScore = 0;

  for (let seed = 1; seed <= 12; seed += 1) {
    const table = createTable('나', seed);
    table.run(Command.startGame(table.room.hostPlayerId));
    for (const player of table.room.players) {
      if (!player.goal) table.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
    }
    while (table.room.phase === 'draft') {
      const current = table.room.players[table.room.currentPlayerIndex]!;
      if (current.bot) table.run(Command.botTurn(current.id));
      else table.run(Command.pick(current.id, table.room.drawn!.id, null));
    }
    for (const player of table.room.players) {
      const score = player.playArea.length;
      if (player.bot) { bots += 1; botScore += score; } else { humans += 1; humanScore += score; }
    }
    // Everyone plays the same number of cards; the difference has to be score.
    assert.equal(botScore / bots, humanScore / humans, '장수는 같아야 합니다');
  }
  assert.ok(bots > 0, '봇이 자리를 채우지 않았습니다');
});
