/**
 * Guards the serialization semantics the legacy `Actor` used to provide.
 * Colyseus does not serialize async message handlers across awaits, so the
 * runtime keeps every transition synchronous instead of adding a queue —
 * these tests pin that contract down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Either } from 'effect';
import { Command } from '../src/core/commands.ts';
import { createRoomRuntime } from '../src/server/game-runtime.ts';
import type { RoomRuntime } from '../src/server/game-runtime.ts';

function startedGame(): RoomRuntime {
  const runtime = createRoomRuntime('Alice');
  runtime.run(Command.joinRoom('Bob'));
  runtime.run(Command.startGame(runtime.state().hostPlayerId));
  for (const player of runtime.state().players) {
    if (!player.goal) runtime.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
  }
  return runtime;
}

test('commands apply synchronously, so they cannot interleave', () => {
  const runtime = createRoomRuntime('Alice');
  const names = ['Bob', 'Carol'];

  const applied = names.map((name) => runtime.run(Command.joinRoom(name)));

  assert.deepEqual(applied.map((player) => player!.name), names);
  assert.deepEqual(runtime.state().players.map((p) => p.name), ['Alice', ...names]);
});

test('a rejected command leaves the state untouched and the runtime usable', () => {
  const runtime = createRoomRuntime('Alice');
  const before = structuredClone(runtime.state());

  const rejected = runtime.tryRun(Command.startGame('not-the-host'));

  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.message, '방장만 시작할 수 있습니다.');
  assert.deepStrictEqual(runtime.state(), before, 'state must not drift on failure');

  // The next command still succeeds.
  const player = runtime.run(Command.joinRoom('Bob'));
  assert.equal(player!.name, 'Bob');
  assert.equal(runtime.state().players.length, 2);
});

test('each command mutates a clone, so earlier snapshots stay frozen in time', () => {
  const runtime = createRoomRuntime('Alice');
  const snapshot = runtime.state();

  runtime.run(Command.joinRoom('Bob'));

  assert.equal(snapshot.players.length, 1, 'the old snapshot must not see the new player');
  assert.equal(runtime.state().players.length, 2);
  assert.notEqual(runtime.state(), snapshot, 'state() returns a new object per transition');
});

test('a bot turn runs exactly one turn and a stale one is rejected', () => {
  const runtime = startedGame();
  const bot = runtime.state().players.find((p) => p.bot)!;

  // Advance until the bot is the one to act.
  let guard = 0;
  while (runtime.state().players[runtime.state().currentPlayerIndex]!.id !== bot.id) {
    const current = runtime.state().players[runtime.state().currentPlayerIndex]!;
    if (current.bot) runtime.run(Command.botTurn(current.id));
    else {
      runtime.run(Command.pick(current.id, current.hand[0]!.id, null));
      if (runtime.state().pendingClaim?.playerId === current.id) {
        runtime.run(Command.finishClaim(current.id));
      }
    }
    assert.ok((guard += 1) < 10, 'bot seat never came up');
  }

  const playedBefore = runtime.state().players.find((p) => p.id === bot.id)!.playArea.length;

  runtime.run(Command.botTurn(bot.id));

  const playedAfter = runtime.state().players.find((p) => p.id === bot.id)!.playArea.length;
  assert.equal(playedAfter, playedBefore + 1, 'exactly one card played');

  // The same bot acting again is now stale — the turn has moved on.
  const stale = runtime.tryRun(Command.botTurn(bot.id));
  assert.ok(Either.isLeft(stale));
  assert.match(stale.left.message, /현재 봇의 턴이 아닙니다|지금은 봇이 행동할 수 없습니다/);
});
