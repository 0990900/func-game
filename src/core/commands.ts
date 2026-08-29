import { Effect } from 'effect';
import { RuleError } from './errors.ts';
import { IdGen, Rng } from './services.ts';
import * as Rules from './rules.ts';
import type { RuleDeps } from './rules.ts';
import type { Player, Room } from './types.ts';

export type GameCommand =
  | { readonly _tag: 'JoinRoom'; readonly name: string }
  | { readonly _tag: 'StartGame'; readonly playerId: string }
  | { readonly _tag: 'ChooseGoal'; readonly playerId: string; readonly goalId: string }
  | { readonly _tag: 'Pick'; readonly playerId: string; readonly cardId: string; readonly marketCardId: string | null }
  | { readonly _tag: 'Claim'; readonly playerId: string; readonly container: string; readonly name: string }
  | { readonly _tag: 'FinishClaim'; readonly playerId: string }
  | { readonly _tag: 'BotTurn'; readonly playerId: string }
  | { readonly _tag: 'SetConnection'; readonly playerId: string; readonly connected: boolean };

export const Command = {
  joinRoom: (name: string): GameCommand => ({ _tag: 'JoinRoom', name }),
  startGame: (playerId: string): GameCommand => ({ _tag: 'StartGame', playerId }),
  chooseGoal: (playerId: string, goalId: string): GameCommand => ({ _tag: 'ChooseGoal', playerId, goalId }),
  pick: (playerId: string, cardId: string, marketCardId: string | null = null): GameCommand =>
    ({ _tag: 'Pick', playerId, cardId, marketCardId }),
  claim: (playerId: string, container: string, name: string): GameCommand =>
    ({ _tag: 'Claim', playerId, container, name }),
  finishClaim: (playerId: string): GameCommand => ({ _tag: 'FinishClaim', playerId }),
  botTurn: (playerId: string): GameCommand => ({ _tag: 'BotTurn', playerId }),
  setConnection: (playerId: string, connected: boolean): GameCommand =>
    ({ _tag: 'SetConnection', playerId, connected }),
} as const;

export interface CommandOutcome {
  readonly room: Room;
  /** Only `JoinRoom` produces a value; every other command returns null. */
  readonly player: Player | null;
}

const ruleDeps: Effect.Effect<RuleDeps, never, Rng | IdGen> = Effect.gen(function* () {
  const rng = yield* Rng;
  const idGen = yield* IdGen;
  return { id: idGen.make, random: rng.next };
});

const asRuleError = (cause: unknown): RuleError =>
  cause instanceof RuleError
    ? cause
    : new RuleError({ message: cause instanceof Error ? cause.message : String(cause) });

/**
 * Applies a mutation to a clone of `room`. On failure the caller's room is
 * untouched, matching the legacy State interpreter's isolation guarantee.
 */
const transition = <A>(room: Room, mutate: (draft: Room) => A): Effect.Effect<{ room: Room; value: A }, RuleError> =>
  Effect.try({
    try: () => {
      const draft = structuredClone(room);
      const value = mutate(draft);
      return { room: draft, value };
    },
    catch: asRuleError,
  });

function apply(deps: RuleDeps, draft: Room, command: GameCommand): Player | null {
  switch (command._tag) {
    case 'JoinRoom':
      return Rules.joinRoom(deps, draft, command.name);
    case 'StartGame':
      if (command.playerId !== draft.hostPlayerId) throw new RuleError({ message: '방장만 시작할 수 있습니다.' });
      Rules.startGame(deps, draft);
      return null;
    case 'ChooseGoal':
      Rules.chooseGoal(deps, draft, command.playerId, command.goalId);
      return null;
    case 'Pick':
      Rules.submitPick(deps, draft, command.playerId, command.cardId, command.marketCardId);
      return null;
    case 'Claim':
      Rules.claimCombo(deps, draft, command.playerId, command.container, command.name);
      return null;
    case 'FinishClaim':
      Rules.finishClaim(deps, draft, command.playerId);
      return null;
    case 'BotTurn':
      Rules.playBotTurn(deps, draft, command.playerId);
      return null;
    case 'SetConnection':
      Rules.setPlayerConnection(deps, draft, command.playerId, command.connected);
      return null;
  }
}

export const runCommand = (
  room: Room,
  command: GameCommand,
): Effect.Effect<CommandOutcome, RuleError, Rng | IdGen> =>
  Effect.gen(function* () {
    const deps = yield* ruleDeps;
    const { room: next, value } = yield* transition(room, (draft) => apply(deps, draft, command));
    return { room: next, player: value };
  });

export const makeRoom = (hostName?: string): Effect.Effect<Room, never, Rng | IdGen> =>
  Effect.gen(function* () {
    const deps = yield* ruleDeps;
    return Rules.createRoom(deps, hostName);
  });
