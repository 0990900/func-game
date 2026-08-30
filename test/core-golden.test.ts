/**
 * Fidelity check for the Effect core port.
 *
 * Drives the legacy JS core and the new TS core through an identical command
 * sequence on identical seeded randomness, then compares the per-viewer
 * publicState projections field by field. Entity ids are randomly generated in
 * both cores, so they are canonicalised by first-encounter order before
 * comparison; every other value must match exactly.
 *
 * This test is deleted with the legacy core at cutover.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Legacy from '../src/game/game.js';
import { Command } from '../src/core/commands.ts';
import { publicState } from '../src/core/public-state.ts';
import { createTable, mulberry32 } from '../src/core/testing.ts';

/**
 * The legacy core is untyped JavaScript and its inferred signatures are too
 * narrow to call from TypeScript (default parameters widen to `null`). Only the
 * surface this test drives is declared; the module is deleted at cutover.
 */
interface LegacyPlayer { readonly id: string; readonly bot: boolean }
interface LegacyRoom {
  readonly players: LegacyPlayer[];
  readonly pendingClaim: { readonly playerId: string } | null;
}
interface LegacyCore {
  createRoom(hostName?: string): LegacyRoom;
  joinRoom(room: LegacyRoom, name: string): LegacyPlayer;
  startGame(room: LegacyRoom): void;
  chooseGoal(room: LegacyRoom, playerId: string, goalId: string): void;
  submitPick(room: LegacyRoom, playerId: string, cardId: string, marketCardId: string | null): void;
  claimCombo(room: LegacyRoom, playerId: string, container: string, name: string): void;
  finishClaim(room: LegacyRoom, playerId: string): void;
  playBotTurn(room: LegacyRoom, playerId: string): void;
  setPlayerConnection(room: LegacyRoom, playerId: string, connected: boolean): void;
  publicState(room: LegacyRoom, viewerId: string | null): unknown;
}

const {
  chooseGoal: oldChooseGoal,
  claimCombo: oldClaimCombo,
  createRoom: oldCreateRoom,
  finishClaim: oldFinishClaim,
  joinRoom: oldJoinRoom,
  playBotTurn: oldPlayBotTurn,
  publicState: oldPublicState,
  setPlayerConnection: oldSetConnection,
  startGame: oldStartGame,
  submitPick: oldSubmitPick,
} = Legacy as unknown as LegacyCore;

const ID_PREFIX = /^(room|player|bot|event)-/;

function canonical(value: string, map: Map<string, string>): string {
  const match = ID_PREFIX.exec(value);
  if (!match) return value;
  const existing = map.get(value);
  if (existing) return existing;
  const token = `${match[1]}#${map.size}`;
  map.set(value, token);
  return token;
}

/** Sorts keys so the walk order — and therefore id canonicalisation — is stable. */
function normalize(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return canonical(value, map);
  if (Array.isArray(value)) return value.map((item) => normalize(item, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalize((value as Record<string, unknown>)[key], map);
    }
    return out;
  }
  return value;
}

const canon = (state: unknown): unknown => normalize(JSON.parse(JSON.stringify(state)), new Map());

/**
 * Asserts the new core still produces everything the legacy one did, with the
 * same values — while allowing it to produce more.
 *
 * The port itself is finished and merged; what this test guards now is drift in
 * the fields both cores share. A field the new core adds for the client (a
 * player's claimed combos, say) is not a regression, and demanding byte
 * equality would make the legacy core a ceiling on the new one until cutover
 * removes it.
 */
function assertSupersetOf(actual: unknown, expected: unknown, where: string): void {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array`);
    assert.equal((actual as unknown[]).length, expected.length, `${where}: length`);
    expected.forEach((item, index) => {
      assertSupersetOf((actual as unknown[])[index], item, `${where}[${index}]`);
    });
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${where}: expected an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertSupersetOf((actual as Record<string, unknown>)[key], value, `${where}.${key}`);
    }
    return;
  }
  assert.deepStrictEqual(actual, expected, where);
}

test('effect core reproduces the legacy core state for a full four-player game', () => {
  const SEED = 20260830;
  // The legacy core reads Math.random directly, so it is swapped in only for
  // the duration of each legacy call — leaving it patched would let the Effect
  // runtime consume from the same stream and desynchronise the two cores.
  const legacyRandom = mulberry32(SEED);
  const legacy = <A>(run: () => A): A => {
    const saved = Math.random;
    Math.random = legacyRandom;
    try {
      return run();
    } finally {
      Math.random = saved;
    }
  };

  {
    const table = createTable('Alice', SEED);
    const oldRoom = legacy(() => oldCreateRoom('Alice'));

    const compare = (label: string): void => {
      const viewers = [...table.room.players.map((p) => p.id), null];
      const oldViewers = [...oldRoom.players.map((p) => p.id), null];
      assert.equal(viewers.length, oldViewers.length, `${label}: player count`);

      viewers.forEach((viewerId, index) => {
        assertSupersetOf(
          canon(publicState(table.room, viewerId)),
          canon(legacy(() => oldPublicState(oldRoom, oldViewers[index] ?? null))),
          `${label}: viewer ${index}`,
        );
      });
    };

    for (const name of ['Bob', 'Carol']) {
      table.run(Command.joinRoom(name));
      legacy(() => oldJoinRoom(oldRoom, name));
    }
    compare('lobby');

    table.run(Command.startGame(table.room.hostPlayerId));
    legacy(() => oldStartGame(oldRoom));
    compare('after start');

    // One seat is left open, so startGame padded the room with a bot.
    assert.equal(table.room.players.length, 4);
    assert.equal(table.room.players.some((p) => p.bot), true);

    table.room.players.forEach((player, index) => {
      if (player.bot) return;
      const goalId = player.goalOptions[0]!.id;
      table.run(Command.chooseGoal(player.id, goalId));
      legacy(() => oldChooseGoal(oldRoom, oldRoom.players[index]!.id, goalId));
    });
    compare('after goals');

    assert.equal(table.room.phase, 'draft');

    let turns = 0;
    while (table.room.phase === 'draft') {
      const index = table.room.currentPlayerIndex;
      const current = table.room.players[index]!;
      const oldCurrent = oldRoom.players[index]!;
      assert.equal(current.bot, oldCurrent.bot, `turn ${turns}: seat kind`);

      if (current.bot) {
        table.run(Command.botTurn(current.id));
        legacy(() => oldPlayBotTurn(oldRoom, oldCurrent.id));
      } else {
        // Alternate a plain pick with a market swap to exercise both paths.
        const cardId = current.hand[0]!.id;
        const marketId = turns % 3 === 0 ? table.room.market[0]!.id : null;
        table.run(Command.pick(current.id, cardId, marketId));
        legacy(() => oldSubmitPick(oldRoom, oldCurrent.id, cardId, marketId));

        if (table.room.pendingClaim?.playerId === current.id) {
          const claims = publicState(table.room, current.id).me!.availableClaims;
          // Claim the first available combo, then pass on the rest.
          const first = claims[0];
          if (first) {
            table.run(Command.claim(current.id, first.container, first.name));
            legacy(() => oldClaimCombo(oldRoom, oldCurrent.id, first.container, first.name));
          }
          if (table.room.pendingClaim?.playerId === current.id) {
            table.run(Command.finishClaim(current.id));
            legacy(() => oldFinishClaim(oldRoom, oldCurrent.id));
          }
        }
      }

      turns += 1;
      if (turns % 7 === 0) compare(`turn ${turns}`);
    }

    assert.equal(turns, 60);
    assert.equal(table.room.phase, 'finished');
    compare('finished');

    // Final scores include the secret-goal component only once finished.
    const finalState = publicState(table.room, table.room.players[0]!.id);
    assert.ok(finalState.scores);
    assert.equal(finalState.scores!.length, 4);

    // Disconnect projection matches too.
    const victim = table.room.players[1]!;
    table.run(Command.setConnection(victim.id, false));
    legacy(() => oldSetConnection(oldRoom, oldRoom.players[1]!.id, false));
    compare('after disconnect');
  }
});
