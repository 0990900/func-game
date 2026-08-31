/**
 * Wildcards fill slots but cannot carry a claim on their own.
 *
 * A claim declares a combo you assembled and locks it away from everyone else
 * for the rest of the game, so it has to be backed by a real card of that
 * container — `*.*`, `*.map` and `Either.*` are stand-ins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Either } from 'effect';
import { claimableCombos, findCombos, isClaimable } from '../src/core/combos.ts';
import { claimScore, scorePlayer } from '../src/core/scoring.ts';
import { Command } from '../src/core/commands.ts';
import { publicState } from '../src/core/public-state.ts';
import { createTable } from '../src/core/testing.ts';
import type { Card } from '../src/core/types.ts';

const exact = (container: 'Maybe' | 'Either' | 'List' | 'Task', operation: string): Card => ({
  id: `${container}.${operation}`,
  kind: 'container-function',
  container,
  operation,
  label: `${container}.${operation}`,
});

const universal: Card = { id: 'w', kind: 'wildcard', container: '*', operation: '*', label: '*.*' };
const containerWild = (container: 'Maybe' | 'Either'): Card =>
  ({ id: `${container}.*`, kind: 'container-wildcard', container, operation: '*', label: `${container}.*` });
const operationWild = (operation: string): Card =>
  ({ id: `*.${operation}`, kind: 'operation-wildcard', container: '*', operation, label: `*.${operation}` });

test('a combo held up only by wildcards is built but not claimable', () => {
  for (const [name, cards] of [
    ['*.*', [universal]],
    ['Maybe.*', [containerWild('Maybe')]],
    ['*.map', [operationWild('map')]],
  ] as const) {
    // The combo exists — it still scores.
    assert.equal(
      findCombos(cards).some((combo) => combo.container === 'Maybe' && combo.name === 'Functor'),
      true,
      `${name}: should still build Maybe Functor`,
    );
    // But it cannot be declared.
    assert.equal(isClaimable(cards, 'Maybe', ['map']), false, `${name}: must not be claimable`);
    assert.equal(
      claimableCombos(cards).some((combo) => combo.container === 'Maybe'),
      false,
      `${name}: must not be offered`,
    );
  }
});

test('one real card of the container is enough to make it claimable', () => {
  // Two real Maybe cards, so the allocator's best move is to finish Maybe
  // Applicative with the wildcard rather than start a line somewhere else.
  const cards = [exact('Maybe', 'map'), exact('Maybe', 'pure'), operationWild('ap')];
  assert.equal(isClaimable(cards, 'Maybe', ['map']), true);
  // Applicative needs map, ap and pure; ap is a wildcard — still claimable.
  assert.equal(isClaimable(cards, 'Maybe', ['map', 'ap', 'pure']), true);
});

test('the real card has to be one the combo asked for', () => {
  // Maybe.zero is a real Maybe card, but Monad does not want it: every
  // operation Monad needs is being covered by a wildcard. These four operation
  // wildcards can spell nothing but a Monad, so that is where they land.
  const cards = [
    exact('Maybe', 'zero'),
    operationWild('map'), operationWild('ap'), operationWild('pure'), operationWild('chain'),
  ];
  assert.equal(findCombos(cards).some((c) => c.container === 'Maybe' && c.name === 'Monad'), true);
  assert.equal(isClaimable(cards, 'Maybe', ['map', 'ap', 'pure', 'chain']), false);
});

test('a wildcard-only combo is built and scored, but never claimed', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;

  // Staged directly: what matters is what happens when the card lands, and the
  // claim is awarded by playing rather than by a prompt that no longer exists.
  table.room.phase = 'draft';
  table.room.drawn = universal;
  table.run(Command.pick(me.id, universal.id));

  const after = table.room.players[0]!;
  assert.equal(after.playArea.length, 1, 'the joker was played');
  assert.equal(
    findCombos(after.playArea).some((combo) => combo.name === 'Functor'),
    true,
    'it still builds Functor, which still scores',
  );
  assert.deepEqual(after.claimGroups, [], 'but a joker alone declares nothing');
  assert.deepEqual(table.room.claimedCombos, []);
});

test('finishing several combos on one card pays a rising bonus', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;

  // Everything Maybe Alternative wants except `ap`. Laying that one card down
  // finishes Apply, Applicative and Alternative at once.
  me.playArea = [
    exact('Maybe', 'map'),
    exact('Maybe', 'pure'),
    exact('Maybe', 'alt'),
    exact('Maybe', 'zero'),
  ];
  const ap = exact('Maybe', 'ap');
  table.room.phase = 'draft';
  table.room.drawn = ap;
  table.run(Command.pick(me.id, ap.id));

  const after = table.room.players[0]!;
  assert.equal(after.claimGroups.length, 1, 'one card, one group');
  assert.deepEqual(
    [...after.claimGroups[0]!].sort(),
    ['Maybe:Alternative', 'Maybe:Applicative', 'Maybe:Apply'],
    'three combos finished together',
  );
  // The nth combo declared together pays n: 1 + 2 + 3.
  assert.equal(claimScore(after.claimGroups), 6);
});

test('one at a time pays one at a time', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;
  table.room.phase = 'draft';

  // Something for the next turn to draw, or the game ends the moment the deck
  // runs dry and the second pick is refused.
  table.room.deck = [exact('Task', 'chain')];

  const map = exact('Maybe', 'map');
  table.room.drawn = map;
  table.run(Command.pick(me.id, map.id));
  assert.deepEqual(table.room.players[0]!.claimGroups, [['Maybe:Functor']]);
  assert.equal(claimScore(table.room.players[0]!.claimGroups), 1);

  const ap = exact('Maybe', 'ap');
  table.room.currentPlayerIndex = table.room.players.findIndex((p) => p.id === me.id);
  table.room.drawn = ap;
  table.run(Command.pick(table.room.players[0]!.id, ap.id));
  assert.equal(
    claimScore(table.room.players[0]!.claimGroups),
    2,
    'two groups of one pay one each, not the bonus',
  );
});

test('a combo someone else declared is not claimed again', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;
  table.room.claimedCombos = ['Maybe:Functor'];
  table.room.phase = 'draft';

  const map = exact('Maybe', 'map');
  table.room.drawn = map;
  table.run(Command.pick(me.id, map.id));

  assert.deepEqual(table.room.players[0]!.claimGroups, [], 'the point was already taken');
});

test('groups accumulate, and the total is readable off them', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;
  table.room.phase = 'draft';

  const play = (card: Card): void => {
    table.room.deck = [exact('Task', 'chain')];
    table.room.currentPlayerIndex = table.room.players.findIndex((p) => p.id === me.id);
    table.room.drawn = card;
    table.run(Command.pick(me.id, card.id));
  };

  // Everything Maybe Alternative wants except `ap`, then `ap`: three at once.
  me.playArea = [exact('Maybe', 'map'), exact('Maybe', 'pure'), exact('Maybe', 'alt'), exact('Maybe', 'zero')];
  play(exact('Maybe', 'ap'));
  // Then a lone Either Functor on its own turn.
  play(exact('Either', 'map'));

  const after = table.room.players[0]!;
  assert.equal(after.claimGroups.length, 2, 'two turns that finished something');
  assert.equal(after.claimGroups[0]!.length, 3);
  assert.deepEqual(after.claimGroups[1], ['Either:Functor']);

  // 6 for the three together, 1 for the one alone — which a flat list of four
  // keys could not have told apart from 2 + 2 (3 + 3) or 4 at once (10).
  assert.equal(claimScore(after.claimGroups), 7);
  assert.equal(scorePlayer(after).claimScore, 7, 'and the score agrees with the groups');
});
