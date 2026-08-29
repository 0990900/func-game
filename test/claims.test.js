import test from 'node:test';
import assert from 'node:assert/strict';
import { claimCombo, createRoom, joinRoom, publicState } from '../src/game/game.js';

const card = (container, operation) => ({ kind: 'container-function', container, operation });

test('the same combo can be claimed only once per game', () => {
  const room = createRoom('A');
  const b = joinRoom(room, 'B');
  const a = room.players[0];
  a.playArea = [card('Maybe', 'map')];
  b.playArea = [card('Maybe', 'map')];

  claimCombo(room, a.id, 'Maybe', 'Functor');

  assert.throws(() => claimCombo(room, b.id, 'Maybe', 'Functor'), /이미 Claim된/);
  assert.equal(publicState(room, b.id).me.availableClaims.length, 0);
  assert.deepEqual(a.claims, ['Maybe:Functor']);
  assert.deepEqual(b.claims, []);
});
