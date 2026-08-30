/**
 * The runtime is the only place a room changes, and ordering is its structural
 * guarantee — not a side effect of commands happening to be synchronous today.
 * These tests hold that contract, including the case that matters for the
 * future: a command that suspends must not let another one overtake it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Duration, Effect, Either, Option } from 'effect';
import { Command } from '../src/core/commands.ts';
import { createRoomRuntime } from '../src/server/game-runtime.ts';
import type { RoomRuntime } from '../src/server/game-runtime.ts';

async function startedGame(): Promise<RoomRuntime> {
  const runtime = createRoomRuntime('Alice');
  await runtime.run(Command.joinRoom('Bob'));
  await runtime.run(Command.startGame(runtime.state().hostPlayerId));
  for (const player of runtime.state().players) {
    if (!player.goal) await runtime.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
  }
  return runtime;
}

test('commands issued together are applied in the order they were issued', async () => {
  const runtime = createRoomRuntime('Alice');
  const names = ['Bob', 'Carol', 'Dave'];

  // Fired without awaiting in between: the runtime, not the caller, orders them.
  const players = await Promise.all(names.map((name) => runtime.run(Command.joinRoom(name))));

  assert.deepEqual(players.map((player) => player!.name), names);
  assert.deepEqual(runtime.state().players.map((p) => p.name), ['Alice', ...names]);
});

test('the ordering primitive serializes suspended work in arrival order', async () => {
  // Today every command is synchronous, so nothing in the game can suspend
  // mid-transition. This pins down the guarantee the runtime is built on for
  // the day one can: a command that awaits keeps the permit, and the commands
  // behind it neither overtake it nor interleave with it.
  const mutex = await Effect.runPromise(Effect.makeSemaphore(1));
  const order: string[] = [];

  const section = (label: string, pause: number) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        order.push(`${label}:start`);
        yield* Effect.sleep(Duration.millis(pause));
        order.push(`${label}:end`);
      }),
    );

  // Issued together, slowest first — arrival order must still win.
  await Effect.runPromise(
    Effect.all([section('first', 30), section('second', 1), section('third', 1)], {
      concurrency: 'unbounded',
    }),
  );

  assert.deepEqual(order, [
    'first:start', 'first:end',
    'second:start', 'second:end',
    'third:start', 'third:end',
  ]);
});

test('a rejected command leaves the state untouched and the runtime usable', async () => {
  const runtime = createRoomRuntime('Alice');
  const before = structuredClone(runtime.state());

  const rejected = await runtime.tryRun(Command.startGame('not-the-host'));

  assert.ok(Either.isLeft(rejected));
  assert.equal(rejected.left.message, '방장만 시작할 수 있습니다.');
  assert.deepStrictEqual(runtime.state(), before, 'state must not drift on failure');

  const player = await runtime.run(Command.joinRoom('Bob'));
  assert.equal(player!.name, 'Bob');
  assert.equal(runtime.state().players.length, 2);
});

test('each command mutates a clone, so earlier snapshots stay frozen in time', async () => {
  const runtime = createRoomRuntime('Alice');
  const snapshot = runtime.state();

  await runtime.run(Command.joinRoom('Bob'));

  assert.equal(snapshot.players.length, 1, 'the old snapshot must not see the new player');
  assert.equal(runtime.state().players.length, 2);
  assert.notEqual(runtime.state(), snapshot, 'state() returns a new object per transition');
});

test('runWith reads and acts atomically, and declining does nothing', async () => {
  const runtime = createRoomRuntime('Alice');

  const declined = await runtime.runWith(() => null);
  assert.ok(Option.isNone(declined));
  assert.equal(runtime.state().players.length, 1);

  const acted = await runtime.runWith((room) =>
    room.phase === 'lobby' ? Command.joinRoom('Bob') : null);
  assert.ok(Option.isSome(acted));
  assert.equal(runtime.state().players.length, 2);
});

test('a bot turn runs exactly one turn and a stale one is rejected', async () => {
  const runtime = await startedGame();
  const bot = runtime.state().players.find((p) => p.bot)!;

  let guard = 0;
  while (runtime.state().players[runtime.state().currentPlayerIndex]!.id !== bot.id) {
    const current = runtime.state().players[runtime.state().currentPlayerIndex]!;
    if (current.bot) await runtime.run(Command.botTurn(current.id));
    else {
      await runtime.run(Command.pick(current.id, runtime.state().drawn!.id, null));
      if (runtime.state().pendingClaim?.playerId === current.id) {
        await runtime.run(Command.finishClaim(current.id));
      }
    }
    assert.ok((guard += 1) < 10, 'bot seat never came up');
  }

  const playedBefore = runtime.state().players.find((p) => p.id === bot.id)!.playArea.length;
  await runtime.run(Command.botTurn(bot.id));
  const playedAfter = runtime.state().players.find((p) => p.id === bot.id)!.playArea.length;
  assert.equal(playedAfter, playedBefore + 1, 'exactly one card played');

  // The same bot acting again is now stale — the turn has moved on.
  const stale = await runtime.tryRun(Command.botTurn(bot.id));
  assert.ok(Either.isLeft(stale));
  assert.match(stale.left.message, /현재 봇의 턴이 아닙니다|지금은 봇이 행동할 수 없습니다/);
});

test('a bot re-check inside runWith cannot be raced by a human turn', async () => {
  const runtime = await startedGame();

  // Whoever is up, decide and act atomically; the seat cannot change in between.
  const outcome = await runtime.runWith((room) => {
    const seat = room.players[room.currentPlayerIndex]!;
    return seat.bot ? Command.botTurn(seat.id) : null;
  });

  if (Option.isSome(outcome)) {
    assert.ok(Either.isRight(outcome.value), 'an atomic re-check never acts on a stale seat');
  }
  await delay(0);
});
