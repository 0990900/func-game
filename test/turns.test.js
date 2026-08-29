import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, startGame, chooseGoal, submitPick, finishClaim, publicState, setPlayerConnection } from '../src/game/game.js';

function fourPlayerDraft() {
  const room = createRoom('A');
  joinRoom(room, 'B');
  joinRoom(room, 'C');
  joinRoom(room, 'D');
  startGame(room);
  for (const p of room.players) chooseGoal(room, p.id, p.goalOptions[0].id);
  return room;
}

function playAndContinue(room, player, card, marketCardId = null) {
  submitPick(room, player.id, card.id, marketCardId);
  if (room.pendingClaim?.playerId === player.id) finishClaim(room, player.id);
}

test('draft is sequential and only current player can pick', () => {
  const room = fourPlayerDraft();
  const [a,b] = room.players;
  assert.equal(publicState(room, a.id).me.isMyTurn, true);
  assert.equal(publicState(room, b.id).me.isMyTurn, false);
  assert.throws(() => submitPick(room, b.id, b.hand[0].id), /현재 당신의 턴/);

  playAndContinue(room, a, a.hand[0]);
  assert.equal(publicState(room, b.id).me.isMyTurn, true);
  assert.equal(room.pick, 1);
});

test('after all four turns, hands pass and pick advances', () => {
  const room = fourPlayerDraft();
  const originalHands = room.players.map(p => p.hand.map(c => c.id));

  for (const p of room.players) playAndContinue(room, p, p.hand[0]);

  assert.equal(room.pick, 2);
  assert.equal(room.currentPlayerIndex, 1);
  // Round 1 passes left: A receives D's remaining hand.
  const expected = originalHands[3].slice(1).sort();
  const actual = room.players[0].hand.map(c => c.id).sort();
  assert.deepEqual(actual, expected);
  assert.deepEqual(publicState(room, room.players[1].id).turnOrder, [
    room.players[1].id, room.players[2].id, room.players[3].id, room.players[0].id,
  ]);
});

test('a new combo pauses the turn for its owner to claim or continue', () => {
  const room = fourPlayerDraft();
  const current = room.players[room.currentPlayerIndex];
  const next = room.players[(room.currentPlayerIndex + 1) % room.players.length];
  current.hand[0] = { id: 'forced-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map' };

  submitPick(room, current.id, 'forced-map');

  const paused = publicState(room, current.id);
  assert.equal(paused.players.find((p) => p.id === current.id).status, 'claiming');
  assert.equal(paused.me.availableClaims.some((combo) => combo.container === 'Maybe' && combo.name === 'Functor'), true);
  assert.throws(() => submitPick(room, next.id, next.hand[0].id), /Claim 선택/);

  finishClaim(room, current.id);
  assert.equal(room.players[room.currentPlayerIndex].id, next.id);
});

test('market exchange resolves immediately on current turn without reservation', () => {
  const room = fourPlayerDraft();
  const a = room.players[0];
  const selected = a.hand[0];
  const market = room.market[0];

  playAndContinue(room, a, selected, market.id);

  assert.equal(a.playArea.at(-1).id, market.id);
  assert.equal(room.market[0].id, selected.id);
  assert.equal(room.currentPlayerIndex, 1);
});

test('three rounds use left, right, left passing and finish after 60 turns', () => {
  const room = fourPlayerDraft();
  const directions = [];
  let turns = 0;

  while (room.phase === 'draft') {
    directions.push(room.direction);
    const current = room.players[room.currentPlayerIndex];
    playAndContinue(room, current, current.hand[0]);
    turns += 1;
  }

  assert.equal(turns, 60);
  assert.equal(room.round, 3);
  assert.deepEqual(new Set(directions.slice(0, 20)), new Set(['left']));
  assert.deepEqual(new Set(directions.slice(20, 40)), new Set(['right']));
  assert.deepEqual(new Set(directions.slice(40)), new Set(['left']));
  assert.equal(room.players.every((p) => p.playArea.length === 15 && p.hand.length === 0), true);
});

test('viewer state hides opponents hands and secret goals during the game', () => {
  const room = fourPlayerDraft();
  const state = publicState(room, room.players[0].id);

  assert.equal(state.me.hand.length, 5);
  assert.ok(state.me.goal);
  for (const player of state.players) {
    assert.equal('hand' in player, false);
    assert.equal('goal' in player, false);
    assert.equal('goalOptions' in player, false);
  }
  assert.equal(JSON.stringify(state.events).includes('Specialist'), false);
  assert.equal(JSON.stringify(state.events).includes('Utility Belt'), false);
});

test('public events and player statuses follow authoritative turns', () => {
  const room = fourPlayerDraft();
  const [a, b] = room.players;

  assert.equal(publicState(room, a.id).players[0].status, 'playing');
  playAndContinue(room, a, a.hand[0]);

  const state = publicState(room, b.id);
  assert.equal(state.players[0].status, 'waiting');
  assert.equal(state.players[1].status, 'playing');
  assert.equal(state.events[0].type, 'pick');
  assert.match(state.events[0].message, /플레이했습니다/);

  setPlayerConnection(room, b.id, false);
  const disconnected = publicState(room, a.id);
  assert.equal(disconnected.players[1].status, 'disconnected');
  assert.equal(disconnected.events[0].type, 'disconnect');
});

test('live public score excludes secret goal and progress counts all turns', () => {
  const room = fourPlayerDraft();
  const a = room.players[0];
  a.playArea = [{ kind: 'container-function', container: 'Maybe', operation: 'map' }];

  const state = publicState(room, a.id);
  assert.deepEqual(state.players[0].publicScore, {
    comboScore: 2,
    utilityScore: 0,
    claimScore: 0,
    total: 2,
  });
  assert.equal('goalScore' in state.players[0].publicScore, false);
  assert.equal(state.progress.turnsCompleted, 1);
  assert.equal(state.progress.turnsTotal, 60);
  assert.equal(state.progress.myPicks, 1);
  assert.equal(state.progress.myPicksTotal, 15);
  assert.equal(state.progress.turnsThisPick, 0);
});
