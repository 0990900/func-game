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
  const cards = [exact('Maybe', 'map'), universal, operationWild('ap')];
  assert.equal(isClaimable(cards, 'Maybe', ['map']), true);
  // Apply needs map and ap; map is real, ap is a wildcard — still claimable.
  assert.equal(isClaimable(cards, 'Maybe', ['map', 'ap']), true);
});

test('the real card has to be one the combo asked for', () => {
  // Maybe.zero is a real Maybe card, but Monad does not want it: every
  // operation Monad needs is being covered by a wildcard.
  const cards = [exact('Maybe', 'zero'), universal, universal, universal, universal];
  assert.equal(findCombos(cards).some((c) => c.container === 'Maybe' && c.name === 'Monad'), true);
  assert.equal(isClaimable(cards, 'Maybe', ['map', 'ap', 'pure', 'chain']), false);
});

test('a wildcard-only combo is refused at the point of claiming', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;
  me.playArea = [universal];
  table.room.pendingClaim = { playerId: me.id, keys: ['Maybe:Functor'] };

  const rejected = table.expectError(Command.claim(me.id, 'Maybe', 'Functor'));
  assert.match(rejected.message, /조커만으로는 Claim할 수 없습니다/);
  assert.deepEqual(table.room.players[0]!.claims, []);
});

test('an unclaimable combo is never offered to the player', () => {
  const table = createTable('A');
  const me = table.room.players[0]!;
  me.playArea = [universal];
  table.room.pendingClaim = { playerId: me.id, keys: ['Maybe:Functor'] };

  assert.deepEqual(publicState(table.room, me.id).me!.availableClaims, []);
});
