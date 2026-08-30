import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DraftRoom } from '../src/server/draft-room.ts';
import type { PublicState } from '../src/core/types.ts';

/** Long enough for the 450-850ms bot delay plus the broadcast that follows. */
const BOT_WINDOW = 1200;
const SETTLE = 60;

interface Seat {
  readonly room: { send: (type: string, payload?: unknown) => void; leave: (consented?: boolean) => Promise<void> };
  readonly state: () => PublicState;
  readonly errors: string[];
}

function watch(sdkRoom: any): Seat {
  let latest: PublicState | null = null;
  const errors: string[] = [];
  sdkRoom.onMessage('state', (message: { state: PublicState }) => { latest = message.state; });
  sdkRoom.onMessage('error', (message: { message: string }) => { errors.push(message.message); });
  return {
    room: sdkRoom,
    state: () => {
      assert.ok(latest, 'no state received yet');
      return latest!;
    },
    errors,
  };
}

/** Keeps the reconnection window short so the suite does not wait it out. */
class TestDraftRoom extends DraftRoom {
  protected override reconnectWindowSeconds = 2;
}

test('DraftRoom runs a game over Colyseus with per-viewer projection', async (t) => {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define('draft', TestDraftRoom);
  const colyseus = await boot(server);
  t.after(async () => { await colyseus.shutdown(); });

  const room = await colyseus.createRoom<DraftRoom>('draft', { name: 'Alice' });
  const alice = watch(await colyseus.connectTo(room, { name: 'Alice' }));
  let bob = watch(await colyseus.connectTo(room, { name: 'Bob' }));
  await delay(SETTLE);

  await t.test('lobby seats the creator as host and the joiner as a player', () => {
    const state = alice.state();
    assert.equal(state.phase, 'lobby');
    assert.equal(state.players.length, 2);
    assert.deepEqual(state.players.map((p) => p.name), ['Alice', 'Bob']);
    assert.equal(state.hostPlayerId, state.me!.id, 'creator holds the host seat');
    assert.notEqual(bob.state().me!.id, state.hostPlayerId);
  });

  await t.test('only the host may start, and the rule message reaches that client alone', async () => {
    bob.room.send('start_game');
    await delay(SETTLE);
    assert.deepEqual(bob.errors, ['방장만 시작할 수 있습니다.']);
    assert.deepEqual(alice.errors, [], 'errors are not broadcast');
    assert.equal(alice.state().phase, 'lobby');
  });

  await t.test('host start fills the empty seats with bots', async () => {
    alice.room.send('start_game');
    await delay(SETTLE);
    const state = alice.state();
    assert.equal(state.phase, 'goal');
    assert.equal(state.players.length, 4);
    assert.equal(state.players.filter((p) => p.bot).length, 2);
  });

  await t.test('each viewer sees only their own hand, goal options and claims', () => {
    const state = alice.state();
    assert.equal(state.me!.goalOptions.length, 2);
    for (const player of state.players) {
      assert.equal('goal' in player, false);
      assert.equal('goalOptions' in player, false);
    }
    assert.notDeepEqual(alice.state().me!.id, bob.state().me!.id);
  });

  await t.test('the draft begins once both humans have chosen a goal', async () => {
    for (const seat of [alice, bob]) {
      seat.room.send('choose_goal', { goalId: seat.state().me!.goalOptions[0]!.id });
      await delay(SETTLE);
    }
    assert.equal(alice.state().phase, 'draft');
    assert.ok(alice.state().drawn, 'a card is drawn for whoever is on turn');
  });

  await t.test('a player off turn is rejected without disturbing the game', async () => {
    const waiting = [alice, bob].find((seat) => !seat.state().me!.isMyTurn);
    if (!waiting) return; // both humans could be mid-bot-turn; nothing to assert
    const before = waiting.errors.length;
    waiting.room.send('pick', { cardId: waiting.state().drawn!.id, marketCardId: null });
    await delay(SETTLE);
    assert.equal(waiting.errors.length, before + 1);
    assert.match(waiting.errors.at(-1)!, /현재 당신의 턴이 아닙니다|Claim 선택/);
  });

  await t.test('bots take their turns on a timer without any client input', async () => {
    const before = alice.state().progress.turnsCompleted;
    // Whoever is up, let the table run: bots act on their own, humans are nudged.
    for (let i = 0; i < 6 && alice.state().progress.turnsCompleted < before + 2; i += 1) {
      const seat = [alice, bob].find((s) => s.state().me!.isMyTurn);
      if (seat) {
        seat.room.send('pick', { cardId: seat.state().drawn!.id, marketCardId: null });
        await delay(SETTLE);
        if (seat.state().me!.canFinishClaim) {
          seat.room.send('finish_claim');
          await delay(SETTLE);
        }
      } else {
        await delay(BOT_WINDOW);
      }
    }
    assert.ok(
      alice.state().progress.turnsCompleted >= before + 2,
      `expected the table to advance, got ${alice.state().progress.turnsCompleted} from ${before}`,
    );
  });

  await t.test('a market swap moves the chosen card into the market', async () => {
    for (let i = 0; i < 8; i += 1) {
      const seat = [alice, bob].find((s) => s.state().me!.isMyTurn);
      if (!seat) { await delay(BOT_WINDOW); continue; }

      const handCard = seat.state().drawn!;
      const marketCard = seat.state().market[0]!;
      seat.room.send('pick', { cardId: handCard.id, marketCardId: marketCard.id });
      await delay(SETTLE);

      const state = seat.state();
      assert.ok(
        state.market.some((card) => card.id === handCard.id),
        'the played card should now sit in the market',
      );
      const mine = state.players.find((p) => p.id === state.me!.id)!;
      assert.ok(
        mine.playArea.some((card) => card.id === marketCard.id),
        'the market card should now sit in the play area',
      );
      return;
    }
    assert.fail('no human turn came up within the window');
  });

  await t.test('an unexpected drop holds the seat, and reconnecting restores it', async () => {
    const bobId = bob.state().me!.id;
    const token = (bob.room as unknown as { reconnectionToken: string }).reconnectionToken;

    await bob.room.leave(false);
    await delay(SETTLE);

    assert.equal(
      alice.state().players.find((p) => p.id === bobId)?.status,
      'disconnected',
      'the seat is held but shown as disconnected',
    );
    assert.equal(alice.state().players.length, 4, 'the seat is not released');

    bob = watch(await colyseus.sdk.reconnect(token));
    await delay(SETTLE);

    assert.notEqual(
      alice.state().players.find((p) => p.id === bobId)?.status,
      'disconnected',
      'reconnecting clears the disconnected status',
    );
    assert.equal(bob.state().me!.id, bobId, 'the same seat comes back, hand included');
    assert.equal(alice.state().events[0]?.type, 'reconnect');
  });

  await t.test('a dropped player is shown as disconnected to everyone else', async () => {
    await bob.room.leave(true);
    await delay(SETTLE);
    const seat = alice.state().players.find((p) => p.id === bob.state().me!.id);
    assert.equal(seat?.status, 'disconnected');
    assert.equal(alice.state().events[0]?.type, 'disconnect');
  });
});
