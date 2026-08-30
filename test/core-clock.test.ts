/**
 * The turn clock and the score log.
 *
 * A seat that never acts used to stall the table forever, and the score was
 * only ever knowable as a running total — there was no record of who pulled
 * ahead when. Both are state the rules now keep, so the server can enforce a
 * deadline and a client can chart the game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../src/core/commands.ts';
import { publicState } from '../src/core/public-state.ts';
import { CARDS_PER_PLAYER, TURN_LIMIT_MS } from '../src/core/rules.ts';
import { createTable } from '../src/core/testing.ts';
import type { Table } from '../src/core/testing.ts';

function fourPlayerDraft(seed = 1): Table {
  const table = createTable('A', seed);
  table.run(Command.joinRoom('B'));
  table.run(Command.joinRoom('C'));
  table.run(Command.joinRoom('D'));
  table.run(Command.startGame(table.room.hostPlayerId));
  for (const player of table.room.players) {
    table.run(Command.chooseGoal(player.id, player.goalOptions[0]!.id));
  }
  return table;
}

function playTurn(table: Table): void {
  const current = table.room.players[table.room.currentPlayerIndex]!;
  if (current.bot) {
    table.run(Command.botTurn(current.id));
    return;
  }
  table.run(Command.pick(current.id, table.room.drawn!.id, null));
  if (table.room.pendingClaim?.playerId === current.id) {
    table.run(Command.finishClaim(current.id));
  }
}

test('a drawn card starts the clock for the seat on turn', () => {
  const table = fourPlayerDraft();
  assert.equal(table.room.turnEndsAt, table.now() + TURN_LIMIT_MS);
});

test('the clock restarts on the next turn, not on a re-read', () => {
  const table = fourPlayerDraft();
  const first = table.room.turnEndsAt;

  // Reading state does nothing to the deadline.
  publicState(table.room, table.room.players[0]!.id);
  assert.equal(table.room.turnEndsAt, first);

  table.advanceClock(5_000);
  playTurn(table);
  assert.equal(table.room.turnEndsAt, table.now() + TURN_LIMIT_MS);
  assert.notEqual(table.room.turnEndsAt, first);
});

test('a pending claim is a decision, so it keeps its own deadline', () => {
  const table = fourPlayerDraft();
  // Drive the table until a human is left holding a claim.
  for (let guard = 0; guard < 80 && !table.room.pendingClaim; guard += 1) {
    const current = table.room.players[table.room.currentPlayerIndex]!;
    if (current.bot) { table.run(Command.botTurn(current.id)); continue; }
    table.advanceClock(1_000);
    table.run(Command.pick(current.id, table.room.drawn!.id, null));
  }
  if (!table.room.pendingClaim) return; // this seed never produced one

  assert.equal(table.room.turnEndsAt, table.now() + TURN_LIMIT_MS);
});

test('the clock stops once the game is over', () => {
  const table = fourPlayerDraft();
  while (table.room.phase === 'draft') playTurn(table);

  assert.equal(table.room.phase, 'finished');
  assert.equal(table.room.turnEndsAt, null);
  assert.equal(publicState(table.room, table.room.players[0]!.id).turnEndsAt, null);
});

test('the deadline is only published while the draft is running', () => {
  const table = createTable('A');
  // Lobby: nobody is on turn, so there is nothing to count down.
  assert.equal(publicState(table.room, table.room.players[0]!.id).turnEndsAt, null);

  const started = fourPlayerDraft();
  const state = publicState(started.room, started.room.players[0]!.id);
  assert.equal(state.turnEndsAt, started.room.turnEndsAt);
  assert.equal(state.turnLimitSeconds, TURN_LIMIT_MS / 1000);
});

test('every completed turn is recorded in the score log', () => {
  const table = fourPlayerDraft();
  assert.equal(table.room.scoreLog.length, 0, 'nothing has been played yet');

  playTurn(table);
  assert.equal(table.room.scoreLog.length, 1);
  assert.equal(table.room.scoreLog[0]!.turn, 1, 'the first play is turn 1');
  assert.equal(
    Object.keys(table.room.scoreLog[0]!.totals).length,
    4,
    'every seat is sampled, not just the one that moved',
  );
});

test('the score log runs the whole game and never goes backwards', () => {
  const table = fourPlayerDraft();
  while (table.room.phase === 'draft') playTurn(table);

  const log = table.room.scoreLog;
  assert.equal(log.length, 60, 'one sample per turn played');
  assert.deepEqual(log.map((s) => s.turn), Array.from({ length: 60 }, (_, i) => i + 1));

  // Cards are never taken away, so no player's public total can fall.
  for (const player of table.room.players) {
    const series = log.map((sample) => sample.totals[player.id]!);
    for (let i = 1; i < series.length; i += 1) {
      assert.ok(series[i]! >= series[i - 1]!, `${player.name} lost points at turn ${i + 1}`);
    }
  }

  // The last sample agrees with what the finished state reports.
  const finished = publicState(table.room, table.room.players[0]!.id);
  for (const player of finished.players) {
    assert.equal(log.at(-1)!.totals[player.id], player.publicScore.total);
  }
});

test('progress reports the real end condition, not rounds and picks', () => {
  const table = fourPlayerDraft();
  const before = publicState(table.room, table.room.players[0]!.id).progress;

  assert.equal(before.cardsPerPlayer, CARDS_PER_PLAYER);
  assert.equal(before.turnsTotal, table.room.players.length * CARDS_PER_PLAYER);
  assert.equal(before.turnsCompleted, 0);
  assert.equal(before.myCards, 0);

  playTurn(table);
  const after = publicState(table.room, table.room.players[0]!.id).progress;
  assert.equal(after.turnsCompleted, 1);
  assert.equal(after.myCards, 1, 'the viewer played the first turn');
});
