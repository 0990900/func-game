import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { boot } from '@colyseus/testing';
import { Server, matchMaker } from 'colyseus';
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

/** Runs a human's turn clock out in milliseconds instead of half a minute. */
class ImpatientDraftRoom extends TestDraftRoom {
  protected override humanDelayMs(): number { return 120; }
}

test('DraftRoom runs a game over Colyseus with per-viewer projection', async (t) => {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define('draft', TestDraftRoom);
  // Same server: `boot()` claims a port, so a second one would race this one.
  server.define('draft-impatient', ImpatientDraftRoom);
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

  await t.test('an idle seat is played for, so one player cannot hold the table', async () => {
    const idleRoom = await colyseus.createRoom<DraftRoom>('draft-impatient', { name: 'Idle' });
    const idle = watch(await colyseus.connectTo(idleRoom, { name: 'Idle' }));
    await delay(SETTLE);

    idle.room.send('start_game');
    await delay(SETTLE);
    idle.room.send('choose_goal', { goalId: idle.state().me!.goalOptions[0]!.id });
    await delay(SETTLE);

    const started = idle.state();
    assert.equal(started.phase, 'draft');
    assert.ok(started.turnEndsAt, 'the client is told when the turn runs out');
    assert.equal(started.turnLimitSeconds, 30);
    assert.equal(started.progress.turnsTotal, 60);

    // Send nothing from here on. Three bots think for 450-850ms each, so a lap
    // of the table costs about two seconds; five buys at least two laps.
    const myId = started.me!.id;
    await delay(5000);

    const later = idle.state();
    assert.ok(later.progress.turnsCompleted >= 6, `the table stalled at ${later.progress.turnsCompleted} turns`);
    assert.ok(
      later.players.find((p) => p.id === myId)!.cardCount >= 2,
      'the idle seat was played for more than once, so the clock rearms each turn',
    );
    assert.equal(later.scoreLog.length, later.progress.turnsCompleted, 'the score log kept up');
    assert.equal(idle.errors.length, 0, idle.errors.join(' / '));
  });

  await t.test('the host can remove a player, and watching takes no seat', async () => {
    const lobby = await colyseus.createRoom<DraftRoom>('draft', { name: 'Host' });
    const host = watch(await colyseus.connectTo(lobby, { name: 'Host' }));
    const guest = watch(await colyseus.connectTo(lobby, { name: 'Guest' }));
    const watcher = watch(await colyseus.connectTo(lobby, { name: '아무개', observe: true }));
    await delay(SETTLE);

    assert.equal(host.state().players.length, 2, 'watching is not sitting down');
    assert.equal(watcher.state().me, null, 'an observer has no seat of their own');

    const guestId = guest.state().me!.id;
    host.room.send('kick_player', { playerId: guestId });
    await delay(SETTLE);

    assert.deepEqual(host.state().players.map((player) => player.name), ['Host']);
    assert.equal(host.errors.length, 0, host.errors.join(' / '));

    // And the seat cannot be taken by someone who is not the host.
    const second = watch(await colyseus.connectTo(lobby, { name: 'Second' }));
    await delay(SETTLE);
    second.room.send('kick_player', { playerId: host.state().me!.id });
    await delay(SETTLE);
    assert.equal(second.errors.length, 1, 'only the host may remove anyone');
    assert.equal(host.state().players.length, 2, 'and nobody was removed');
  });

  await t.test('an empty lobby hands the host chair over, not the host', async () => {
    const lobby = await colyseus.createRoom<DraftRoom>('draft', { name: '먼저' });
    const first = watch(await colyseus.connectTo(lobby, { name: '먼저' }));
    // A watcher keeps the room alive once the player has gone.
    const watcher = watch(await colyseus.connectTo(lobby, { name: '구경', observe: true }));
    await delay(SETTLE);
    assert.equal(first.state().players[0]!.name, '먼저');

    await first.room.leave(true);
    await delay(SETTLE);

    const second = watch(await colyseus.connectTo(lobby, { name: '나중' }));
    await delay(SETTLE);

    const seated = second.state().players;
    assert.equal(seated.length, 1, 'the empty chair is reused, not doubled up');
    assert.equal(seated[0]!.name, '나중', 'and it belongs to whoever sat in it');
    assert.equal(second.state().me!.id, second.state().hostPlayerId, 'who can start the game');
    assert.equal(watcher.state().players[0]!.name, '나중', 'as everyone else sees it too');
  });

  await t.test('the lobby is told what the room holds, and when that changes', async () => {
    const lobby = await colyseus.createRoom<DraftRoom>('draft', { name: '집주인' });
    watch(await colyseus.connectTo(lobby, { name: '집주인' }));
    await delay(SETTLE);

    const look = async (): Promise<Record<string, unknown>> => {
      const [found] = await matchMaker.query({ roomId: lobby.roomId });
      return (found?.metadata ?? {}) as Record<string, unknown>;
    };

    assert.deepEqual(
      { ...(await look()) },
      { host: '집주인', phase: 'lobby', humans: 1, seats: 1, observers: 0 },
    );

    const watcher = watch(await colyseus.connectTo(lobby, { name: '구경', observe: true }));
    await delay(SETTLE);
    assert.equal((await look())['observers'], 1, 'a watcher is counted as they arrive');
    assert.equal((await look())['humans'], 1, 'and never as a player');

    // Leaving has to put it back, or the lobby overstates the room forever.
    await watcher.room.leave(true);
    await delay(SETTLE);
    assert.equal((await look())['observers'], 0);

    watch(await colyseus.connectTo(lobby, { name: '둘째' }));
    await delay(SETTLE);
    assert.equal((await look())['humans'], 2);
    assert.equal((await look())['seats'], 2);
  });

  await t.test('an idle timer is dropped when the room goes away', async () => {
    const doomed = await colyseus.createRoom<DraftRoom>('draft', { name: '잠깐' });
    const seat = watch(await colyseus.connectTo(doomed, { name: '잠깐' }));
    await delay(SETTLE);

    seat.room.send('start_game');
    await delay(SETTLE);
    seat.room.send('choose_goal', { goalId: seat.state().me!.goalOptions[0]!.id });
    await delay(SETTLE);
    assert.equal(seat.state().phase, 'draft', 'a timer is running');

    // Nothing should be left ticking against a disposed room.
    await seat.room.leave(true);
    await doomed.disconnect();
    await delay(BOT_WINDOW);
  });
});
