import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/core/cards.ts';
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

/** Plays whoever is on turn, taking the drawn card, and settles any claim. */
function playTurn(table: Table, marketCardId: string | null = null): void {
  const current = table.room.players[table.room.currentPlayerIndex]!;
  const drawn = table.room.drawn!;
  if (current.bot) {
    table.run(Command.botTurn(current.id));
    return;
  }
  table.run(Command.pick(current.id, drawn.id, marketCardId));
}

test('the draft deals no hands: the player on turn draws one card', () => {
  const table = fourPlayerDraft();
  assert.equal(table.room.phase, 'draft');
  assert.ok(table.room.drawn, 'a card is waiting for the player on turn');
  assert.equal(table.room.market.length, 4);
  // Nobody holds cards; the only private thing left is a secret goal.
  assert.equal(table.room.players.every((p) => p.playArea.length === 0), true);
});

test('only the current player can take the drawn card, and only that card', () => {
  const table = fourPlayerDraft();
  const [a, b] = table.room.players;
  const drawn = table.room.drawn!;

  assert.match(table.expectError(Command.pick(b!.id, drawn.id)).message, /현재 당신의 턴/);
  assert.match(table.expectError(Command.pick(a!.id, 'not-the-card')).message, /뽑은 카드가 아닙니다/);

  playTurn(table);
  assert.equal(table.room.players[0]!.playArea.length, 1);
});

test('a new card is drawn for each turn and the seat moves on', () => {
  const table = fourPlayerDraft();
  const first = table.room.drawn!.id;
  const seat = table.room.currentPlayerIndex;

  playTurn(table);

  assert.notEqual(table.room.currentPlayerIndex, seat);
  assert.ok(table.room.drawn, 'the next player has a card waiting');
  assert.notEqual(table.room.drawn!.id, first);
});

test('a market swap puts the drawn card in the market and takes its card', () => {
  const table = fourPlayerDraft();
  // Find a human turn so the choice is ours to make.
  while (table.room.players[table.room.currentPlayerIndex]!.bot) playTurn(table);

  const player = table.room.players[table.room.currentPlayerIndex]!;
  const drawn = table.room.drawn!;
  const wanted = table.room.market[0]!;

  playTurn(table, wanted.id);

  const mine = table.room.players.find((p) => p.id === player.id)!;
  assert.equal(mine.playArea.at(-1)!.id, wanted.id, 'the market card is played');
  assert.equal(table.room.market.some((c) => c.id === drawn.id), true, 'the drawn card takes its place');
  assert.equal(table.room.market.length, 4);
});

test('the reverse card flips the order and is never played', () => {
  const table = fourPlayerDraft();
  // Put the reverse card on top of the deck for the next draw.
  const reverse = { id: 'rev', kind: 'order-reverse' as const, container: null, operation: 'reverse', label: '순서 바꾸기' };
  table.room.deck.unshift(reverse);
  const before = table.room.direction;

  playTurn(table);

  assert.notEqual(table.room.direction, before, 'the order reversed');
  assert.equal(table.room.drawn!.id === 'rev', false, 'the reverse card is not on offer');
  assert.equal(
    table.room.players.some((p) => p.playArea.some((c) => c.id === 'rev')),
    false,
    'and it never reaches a play area',
  );
  assert.equal(table.room.discard.some((c) => c.id === 'rev'), true, 'it is set aside');
});

test('the game ends once everyone has fifteen cards', () => {
  const table = fourPlayerDraft();
  let turns = 0;

  while (table.room.phase === 'draft') {
    playTurn(table);
    turns += 1;
    assert.ok(turns <= 80, 'the game should finish');
  }

  assert.equal(turns, 60);
  assert.equal(table.room.players.every((p) => p.playArea.length === 15), true);
});

test('viewer state hides secret goals and shows the drawn card to everyone', () => {
  const table = fourPlayerDraft();
  const state = publicState(table.room, table.room.players[0]!.id);

  assert.ok(state.drawn, 'the draw is face up');
  assert.ok(state.me!.goal);
  for (const player of state.players) {
    assert.equal('goal' in player, false);
    assert.equal('goalOptions' in player, false);
  }
  assert.equal(JSON.stringify(state.events).includes('Specialist'), false);
});

test('turn order follows the direction and starts at the player on turn', () => {
  const table = fourPlayerDraft();
  const order = publicState(table.room, table.room.players[0]!.id).turnOrder;

  assert.equal(order.length, 4);
  assert.equal(order[0], table.room.players[table.room.currentPlayerIndex]!.id);
  assert.equal(new Set(order).size, 4, 'every seat appears once');
});

test('live public score excludes the secret goal', () => {
  const table = fourPlayerDraft();
  const a = table.room.players[0]!;
  a.playArea = [{
    id: 'staged-map', kind: 'container-function', container: 'Maybe', operation: 'map', label: 'Maybe.map',
  }];

  const state = publicState(table.room, a.id);
  assert.deepEqual(state.players[0]!.publicScore, {
    comboScore: 2, utilityScore: 0, claimScore: 0, instanceScore: 0, total: 2,
  });
  assert.equal('goalScore' in state.players[0]!.publicScore, false);
});

test('a disconnect shows up for everyone', () => {
  const table = fourPlayerDraft();
  const b = table.room.players[1]!;

  table.run(Command.setConnection(b.id, false));

  const state = publicState(table.room, table.room.players[0]!.id);
  assert.equal(state.players[1]!.status, 'disconnected');
  assert.equal(state.events[0]!.type, 'disconnect');
});

test('the host can clear a seat before the game starts', () => {
  const table = createTable('A');
  const guest = table.run(Command.joinRoom('B'))!;
  const host = table.room.hostPlayerId;
  assert.equal(table.room.players.length, 2);

  table.run(Command.kickPlayer(host, guest.id));
  assert.deepEqual(table.room.players.map((player) => player.id), [host]);
  // `room.events` is oldest first; only the projection reverses it.
  assert.equal(table.room.events.at(-1)!.type, 'disconnect');
  assert.match(table.room.events.at(-1)!.message, /나갔습니다/);
});

test('who may not be removed, and when', () => {
  const table = createTable('A');
  const guest = table.run(Command.joinRoom('B'))!;
  const host = table.room.hostPlayerId;

  assert.match(table.expectError(Command.kickPlayer(guest.id, host)).message, /방장만/);
  assert.match(table.expectError(Command.kickPlayer(host, host)).message, /방장은 내보낼 수 없습니다/);

  table.run(Command.joinRoom('C'));
  table.run(Command.joinRoom('D'));
  table.run(Command.startGame(host));
  assert.match(
    table.expectError(Command.kickPlayer(host, guest.id)).message,
    /시작된 뒤에는/,
    'a running draft has fixed seats and a turn pointing at one of them',
  );
  assert.equal(table.room.players.length, 4, 'a refused kick changes nothing');
});

test('the deck actually contains the card that reverses the order', () => {
  // The reverse card had a kind, a draw rule, a flip, an event and a sound, and
  // `createDeck` never made one. The test that covered it pushed the card onto
  // the deck itself, so it proved the handling worked and never asked whether
  // the card existed.
  const reverses = createDeck().filter((card) => card.kind === 'order-reverse');
  assert.equal(reverses.length, 1, 'exactly one, or the order flips too often');
});

test('a whole game turns the order around', () => {
  // End to end, through the shuffle, rather than with a card placed by hand:
  // that is the part that was broken.
  const flipped = Array.from({ length: 8 }, (_, seed) => {
    const table = fourPlayerDraft(seed + 1);
    const started = table.room.direction;
    while (table.room.phase === 'draft') playTurn(table);
    return table.room.direction !== started;
  });

  // One card in sixty-seven, and the game ends after sixty draws, so it is not
  // certain in any single game — but it cannot be nothing across eight.
  assert.ok(flipped.some(Boolean), '순서 바꾸기 카드가 한 판도 나오지 않았습니다');
});
