/**
 * Per-room command runner: owns one room's authoritative state and applies
 * commands to it.
 *
 * Serialization note — this is the invariant the legacy `Actor` existed to
 * provide, and why there is no queue here. Every core command is a synchronous
 * Effect, so `run`/`tryRun` complete without yielding to the event loop: two
 * commands can never interleave, and a rejected command leaves the state
 * untouched (the core applies mutations to a clone). Callers must therefore
 * never `await` between reading `state()` and running a command — read it
 * again afterwards instead.
 */
import { Effect, Either, Layer } from 'effect';
import { makeRoom, runCommand } from '../core/commands.ts';
import type { GameCommand } from '../core/commands.ts';
import type { RuleError } from '../core/errors.ts';
import { IdGen, IdGenLive, Rng, RngLive } from '../core/services.ts';
import type { Player, Room } from '../core/types.ts';

const services = Layer.merge(RngLive, IdGenLive);

const run = <A, E>(effect: Effect.Effect<A, E, Rng | IdGen>): A =>
  Effect.runSync(Effect.provide(effect, services));

export interface RoomRuntime {
  /** The authoritative room. Never mutate it; treat each read as a snapshot. */
  readonly state: () => Room;
  /** Applies a command, throwing RuleError if the rules reject it. */
  readonly run: (command: GameCommand) => Player | null;
  /** Applies a command, returning the rule error instead of throwing. */
  readonly tryRun: (command: GameCommand) => Either.Either<Player | null, RuleError>;
}

export function createRoomRuntime(hostName: string): RoomRuntime {
  let room = run(makeRoom(hostName));

  const apply = (command: GameCommand): Either.Either<Player | null, RuleError> => {
    const result = run(Effect.either(runCommand(room, command)));
    if (Either.isLeft(result)) return Either.left(result.left);
    room = result.right.room;
    return Either.right(result.right.player);
  };

  return {
    state: () => room,
    run: (command) => {
      const result = apply(command);
      if (Either.isLeft(result)) throw result.left;
      return result.right;
    },
    tryRun: apply,
  };
}
