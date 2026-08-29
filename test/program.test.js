import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoom } from '../src/game/game.js';
import { Game, gameInterpreter } from '../src/game/program.js';
import { createRoomActor, sendToActor } from '../src/server/room-actor.js';

test('Free game command is interpreted as an immutable State transition', async () => {
  const original = createRoom('A');
  const transition = await gameInterpreter.run(Game.joinRoom('B'));
  const [player, next] = transition.run(original);

  assert.equal(original.players.length, 1);
  assert.equal(next.players.length, 2);
  assert.equal(player.name, 'B');
});

test('room Actor serializes concurrent game commands', async () => {
  const actor = createRoomActor(createRoom('A'));
  const [b, c, d] = await Promise.all([
    sendToActor(actor, Game.joinRoom('B')),
    sendToActor(actor, Game.joinRoom('C')),
    sendToActor(actor, Game.joinRoom('D')),
  ]);

  assert.deepEqual(actor.getState().players.map((player) => player.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual([b.name, c.name, d.name], ['B', 'C', 'D']);
});

test('failed Actor command preserves state and does not block its queue', async () => {
  const room = createRoom('A');
  const actor = createRoomActor(room);

  await assert.rejects(sendToActor(actor, Game.startGame('not-host')), /방장만/);
  const player = await sendToActor(actor, Game.joinRoom('B'));

  assert.equal(player.name, 'B');
  assert.equal(actor.getState().players.length, 2);
  assert.equal(room.players.length, 1);
});

test('bot command performs exactly one turn and rejects a stale player', async () => {
  const actor = createRoomActor(createRoom('A'));
  const bot = await sendToActor(actor, Game.joinRoom('Bot'));
  const room = actor.getState();
  bot.bot = true;
  room.players[1].bot = true;
  room.phase = 'draft';
  room.currentPlayerIndex = 1;
  room.players[1].hand = [{ id: 'bot-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map' }];

  await assert.rejects(sendToActor(actor, Game.botTurn('stale')), /현재 봇의 턴/);
  await sendToActor(actor, Game.botTurn(bot.id));

  assert.equal(actor.getState().players[1].playArea.length, 1);
  assert.equal(actor.getState().currentPlayerIndex, 0);
});
