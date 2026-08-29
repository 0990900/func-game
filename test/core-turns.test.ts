import test from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../src/core/commands.ts';
import { publicState } from '../src/core/public-state.ts';
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

function playAndContinue(table: Table, playerId: string, cardId: string, marketCardId: string | null = null): void {
  table.run(Command.pick(playerId, cardId, marketCardId));
  if (table.room.pendingClaim?.playerId === playerId) table.run(Command.finishClaim(playerId));
}

test('draft is sequential and only current player can pick', () => {
  const table = fourPlayerDraft();
  const [a, b] = table.room.players;
  assert.equal(publicState(table.room, a!.id).me!.isMyTurn, true);
  assert.equal(publicState(table.room, b!.id).me!.isMyTurn, false);
  assert.match(table.expectError(Command.pick(b!.id, b!.hand[0]!.id)).message, /현재 당신의 턴/);

  playAndContinue(table, a!.id, a!.hand[0]!.id);
  assert.equal(publicState(table.room, b!.id).me!.isMyTurn, true);
  assert.equal(table.room.pick, 1);
});

test('after all four turns, hands pass and pick advances', () => {
  const table = fourPlayerDraft();
  const originalHands = table.room.players.map((p) => p.hand.map((c) => c.id));

  for (const player of [...table.room.players]) {
    playAndContinue(table, player.id, table.room.players.find((p) => p.id === player.id)!.hand[0]!.id);
  }

  assert.equal(table.room.pick, 2);
  assert.equal(table.room.currentPlayerIndex, 1);
  // Round 1 passes left: A receives D's remaining hand.
  const expected = originalHands[3]!.slice(1).sort();
  const actual = table.room.players[0]!.hand.map((c) => c.id).sort();
  assert.deepEqual(actual, expected);
  assert.deepEqual(publicState(table.room, table.room.players[1]!.id).turnOrder, [
    table.room.players[1]!.id, table.room.players[2]!.id, table.room.players[3]!.id, table.room.players[0]!.id,
  ]);
});

test('a new combo pauses the turn for its owner to claim or continue', () => {
  const table = fourPlayerDraft();
  const current = table.room.players[table.room.currentPlayerIndex]!;
  const next = table.room.players[(table.room.currentPlayerIndex + 1) % table.room.players.length]!;
  current.hand[0] = {
    id: 'forced-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map',
  };

  table.run(Command.pick(current.id, 'forced-map'));

  const paused = publicState(table.room, current.id);
  assert.equal(paused.players.find((p) => p.id === current.id)!.status, 'claiming');
  assert.equal(
    paused.me!.availableClaims.some((combo) => combo.container === 'Maybe' && combo.name === 'Functor'),
    true,
  );
  assert.match(table.expectError(Command.pick(next.id, next.hand[0]!.id)).message, /Claim 선택/);

  table.run(Command.finishClaim(current.id));
  assert.equal(table.room.players[table.room.currentPlayerIndex]!.id, next.id);
});

test('market exchange resolves immediately on current turn without reservation', () => {
  const table = fourPlayerDraft();
  const a = table.room.players[0]!;
  const selectedId = a.hand[0]!.id;
  const marketId = table.room.market[0]!.id;

  playAndContinue(table, a.id, selectedId, marketId);

  assert.equal(table.room.players[0]!.playArea.at(-1)!.id, marketId);
  assert.equal(table.room.market[0]!.id, selectedId);
  assert.equal(table.room.currentPlayerIndex, 1);
});

test('three rounds use left, right, left passing and finish after 60 turns', () => {
  const table = fourPlayerDraft();
  const directions: string[] = [];
  let turns = 0;

  while (table.room.phase === 'draft') {
    directions.push(table.room.direction);
    const current = table.room.players[table.room.currentPlayerIndex]!;
    playAndContinue(table, current.id, current.hand[0]!.id);
    turns += 1;
  }

  assert.equal(turns, 60);
  assert.equal(table.room.round, 3);
  assert.deepEqual(new Set(directions.slice(0, 20)), new Set(['left']));
  assert.deepEqual(new Set(directions.slice(20, 40)), new Set(['right']));
  assert.deepEqual(new Set(directions.slice(40)), new Set(['left']));
  assert.equal(table.room.players.every((p) => p.playArea.length === 15 && p.hand.length === 0), true);
});

test('viewer state hides opponents hands and secret goals during the game', () => {
  const table = fourPlayerDraft();
  const state = publicState(table.room, table.room.players[0]!.id);

  assert.equal(state.me!.hand.length, 5);
  assert.ok(state.me!.goal);
  for (const player of state.players) {
    assert.equal('hand' in player, false);
    assert.equal('goal' in player, false);
    assert.equal('goalOptions' in player, false);
  }
  assert.equal(JSON.stringify(state.events).includes('Specialist'), false);
  assert.equal(JSON.stringify(state.events).includes('Utility Belt'), false);
});

test('public events and player statuses follow authoritative turns', () => {
  const table = fourPlayerDraft();
  const [a, b] = table.room.players;

  assert.equal(publicState(table.room, a!.id).players[0]!.status, 'playing');
  playAndContinue(table, a!.id, a!.hand[0]!.id);

  const state = publicState(table.room, b!.id);
  assert.equal(state.players[0]!.status, 'waiting');
  assert.equal(state.players[1]!.status, 'playing');
  assert.equal(state.events[0]!.type, 'pick');
  assert.match(state.events[0]!.message, /플레이했습니다/);

  table.run(Command.setConnection(b!.id, false));
  const disconnected = publicState(table.room, a!.id);
  assert.equal(disconnected.players[1]!.status, 'disconnected');
  assert.equal(disconnected.events[0]!.type, 'disconnect');
});

test('live public score excludes secret goal and progress counts all turns', () => {
  const table = fourPlayerDraft();
  const a = table.room.players[0]!;
  a.playArea = [{
    id: 'staged-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map',
  }];

  const state = publicState(table.room, a.id);
  assert.deepEqual(state.players[0]!.publicScore, {
    comboScore: 2,
    utilityScore: 0,
    claimScore: 0,
    total: 2,
  });
  assert.equal('goalScore' in state.players[0]!.publicScore, false);
  assert.equal(state.progress.turnsCompleted, 1);
  assert.equal(state.progress.turnsTotal, 60);
  assert.equal(state.progress.myPicks, 1);
  assert.equal(state.progress.myPicksTotal, 15);
  assert.equal(state.progress.turnsThisPick, 0);
});

test('the same combo can be claimed only once per game', () => {
  const table = createTable('A');
  const b = table.run(Command.joinRoom('B'))!;
  const a = table.room.players[0]!;
  const mapCard = {
    id: 'staged-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map',
  } as const;
  a.playArea = [mapCard];
  table.room.players.find((p) => p.id === b.id)!.playArea = [{ ...mapCard, id: 'staged-map-b' }];
  table.room.pendingClaim = { playerId: a.id, keys: ['Maybe:Functor'] };

  table.run(Command.claim(a.id, 'Maybe', 'Functor'));

  table.room.pendingClaim = { playerId: b.id, keys: ['Maybe:Functor'] };
  assert.match(table.expectError(Command.claim(b.id, 'Maybe', 'Functor')).message, /이미 Claim된/);
  assert.equal(publicState(table.room, b.id).me!.availableClaims.length, 0);
  assert.deepEqual(table.room.players.find((p) => p.id === a.id)!.claims, ['Maybe:Functor']);
  assert.deepEqual(table.room.players.find((p) => p.id === b.id)!.claims, []);
});
