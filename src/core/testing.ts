import { Effect, Either, Layer } from 'effect';
import { runCommand, makeRoom } from './commands.ts';
import type { GameCommand } from './commands.ts';
import { idGenSequential, rngFrom, IdGen, Rng } from './services.ts';
import type { RuleError } from './errors.ts';
import type { Player, Room } from './types.ts';

/** Deterministic PRNG so shuffles and bot tie-breaks are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Table {
  readonly room: Room;
  /** Runs a command, advancing the table. Throws if the command is rejected. */
  run: (command: GameCommand) => Player | null;
  /** Runs a command expecting rejection; returns the rule error. */
  expectError: (command: GameCommand) => RuleError;
  /** Replaces the room, for tests that stage state directly. */
  set: (room: Room) => void;
}

export function createTable(hostName = 'A', seed = 1): Table {
  const layer = Layer.merge(rngFrom(mulberry32(seed)), idGenSequential());
  const provide = <A, E>(effect: Effect.Effect<A, E, Rng | IdGen>): Effect.Effect<A, E> =>
    Effect.provide(effect, layer);

  let room = Effect.runSync(provide(makeRoom(hostName)));

  return {
    get room() { return room; },
    set(next: Room) { room = next; },
    run(command) {
      const outcome = Effect.runSync(provide(runCommand(room, command)));
      room = outcome.room;
      return outcome.player;
    },
    expectError(command) {
      const result = Effect.runSync(provide(Effect.either(runCommand(room, command))));
      if (Either.isRight(result)) {
        throw new Error(`expected ${command._tag} to fail, but it succeeded`);
      }
      return result.left;
    },
  };
}
