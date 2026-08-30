/**
 * Per-room command runner: owns one room's authoritative state and is the only
 * place it changes.
 *
 * Ordering is a property of this structure, not of what a command happens to
 * do. Every command runs inside a one-permit semaphore, so commands are applied
 * one at a time in the order they arrive, and each one's read-modify-write is
 * atomic. A command that later needs to await something — persistence, a remote
 * bot, an external check — suspends while holding the permit; queued commands
 * wait their turn. Nothing here or in the callers changes to allow that.
 *
 * `runWith` exists so "look at the room, then decide what to do" is atomic too:
 * the room cannot move between the read and the command it produces.
 */
import { Effect, Either, Layer, Option } from 'effect';
import { makeRoom, runCommand } from '../core/commands.ts';
import type { GameCommand } from '../core/commands.ts';
import type { RuleError } from '../core/errors.ts';
import { Clock, ClockLive, IdGen, IdGenLive, Rng, RngLive } from '../core/services.ts';
import type { Player, Room } from '../core/types.ts';

const services = Layer.mergeAll(RngLive, IdGenLive, ClockLive);

const provide = <A, E>(effect: Effect.Effect<A, E, Rng | IdGen | Clock>): Effect.Effect<A, E> =>
  Effect.provide(effect, services);

/** What a command produced: the joined player for `JoinRoom`, otherwise null. */
export type CommandResult = Either.Either<Player | null, RuleError>;

export interface RoomRuntime {
  /** The authoritative room. Treat each read as a snapshot. */
  readonly state: () => Room;
  /** Applies a command in arrival order. Rejects the promise on a rule error. */
  readonly run: (command: GameCommand) => Promise<Player | null>;
  /** Applies a command in arrival order, returning the rule error as a value. */
  readonly tryRun: (command: GameCommand) => Promise<CommandResult>;
  /**
   * Reads the room and acts on it atomically. `build` returns `null` to do
   * nothing, which yields `Option.none()`.
   */
  readonly runWith: (
    build: (room: Room) => GameCommand | null,
  ) => Promise<Option.Option<CommandResult>>;
}

export function createRoomRuntime(hostName: string): RoomRuntime {
  let room = Effect.runSync(provide(makeRoom(hostName)));
  const mutex = Effect.runSync(Effect.makeSemaphore(1));

  /** The critical section: read, apply, commit. */
  const critical = (build: (room: Room) => GameCommand | null) =>
    mutex.withPermits(1)(
      Effect.gen(function* () {
        const command = build(room);
        if (!command) return Option.none<CommandResult>();

        const result = yield* Effect.either(provide(runCommand(room, command)));
        if (Either.isLeft(result)) return Option.some(Either.left(result.left));

        room = result.right.room;
        return Option.some(Either.right(result.right.player));
      }),
    );

  const tryRun = async (command: GameCommand): Promise<CommandResult> => {
    const outcome = await Effect.runPromise(critical(() => command));
    // `build` returned a command, so the result is always present.
    return Option.getOrThrow(outcome);
  };

  return {
    state: () => room,
    tryRun,
    run: async (command) => {
      const result = await tryRun(command);
      if (Either.isLeft(result)) throw result.left;
      return result.right;
    },
    runWith: (build) => Effect.runPromise(critical(build)),
  };
}
