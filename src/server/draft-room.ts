import { Either, Option } from 'effect';
import { Room, ServerError } from 'colyseus';
import type { Client, Delayed } from 'colyseus';
import { Command } from '../core/commands.ts';
import type { GameCommand } from '../core/commands.ts';
import { RuleError } from '../core/errors.ts';
import { publicState } from '../core/public-state.ts';
import { createRoomRuntime } from './game-runtime.ts';
import type { CommandResult, RoomRuntime } from './game-runtime.ts';
import type { Room as RoomState } from '../core/types.ts';

/** Seconds a dropped player keeps their seat before it is released. */
export const RECONNECT_WINDOW = 120;

const BOT_DELAY_MIN = 450;
const BOT_DELAY_SPREAD = 401;

export interface JoinOptions {
  readonly name?: string;
}

interface PickMessage { readonly cardId: string; readonly marketCardId?: string | null }
interface GoalMessage { readonly goalId: string }
interface ClaimMessage { readonly container: string; readonly name: string }

export class DraftRoom extends Room {
  override maxClients = 4;

  /** Overridable so tests do not have to wait out the real window. */
  protected reconnectWindowSeconds = RECONNECT_WINDOW;

  /**
   * How long to leave a human seat before acting for it. The deadline itself
   * belongs to the rules; this only reads it, and exists as a seam so tests do
   * not have to sit through a real turn limit.
   */
  protected humanDelayMs(room: RoomState): number {
    return Math.max(0, (room.turnEndsAt ?? Date.now()) - Date.now());
  }

  private game: RoomRuntime | null = null;
  /** Colyseus sessionId -> game playerId. Survives reconnection. */
  private readonly seats = new Map<string, string>();
  /**
   * The one pending auto-action for whoever the table is waiting on: a bot
   * thinking, or a human's turn clock running out. Bots and humans differ only
   * in how long the wait is, so they share the timer rather than racing two.
   */
  private turnTimer: Delayed | null = null;
  /** Identifies the wait the timer was armed for, so a re-broadcast never resets it. */
  private turnTimerKey: string | null = null;

  private get runtime(): RoomRuntime {
    if (!this.game) throw new Error('room used before onCreate');
    return this.game;
  }

  override onCreate(options: JoinOptions): void {
    this.game = createRoomRuntime(options?.name ?? 'Player');
    this.autoDispose = true;

    this.onMessage('start_game', (client) => this.dispatch(client, Command.startGame));
    this.onMessage('choose_goal', (client, message: GoalMessage) =>
      this.dispatch(client, (playerId) => Command.chooseGoal(playerId, message?.goalId)));
    this.onMessage('pick', (client, message: PickMessage) =>
      this.dispatch(client, (playerId) => Command.pick(playerId, message?.cardId, message?.marketCardId ?? null)));
    this.onMessage('claim', (client, message: ClaimMessage) =>
      this.dispatch(client, (playerId) => Command.claim(playerId, message?.container, message?.name)));
    this.onMessage('finish_claim', (client) => this.dispatch(client, Command.finishClaim));
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    // The room is created with its host already seated, so the first client to
    // arrive is the creator and takes that seat; everyone else joins the game.
    if (this.seats.size === 0) {
      this.seats.set(client.sessionId, this.runtime.state().hostPlayerId);
    } else {
      const result = await this.runtime.tryRun(Command.joinRoom(options?.name ?? 'Player'));
      if (Either.isLeft(result)) throw new ServerError(400, result.left.message);
      this.seats.set(client.sessionId, result.right!.id);
    }
    this.broadcastState();
  }

  /** An unexpected disconnect: hold the seat open for a while. */
  override async onDrop(client: Client): Promise<void> {
    const playerId = this.seats.get(client.sessionId);
    if (!playerId) return;

    await this.setConnected(playerId, false);
    try {
      await this.allowReconnection(client, this.reconnectWindowSeconds);
    } catch {
      // Window expired; onLeave releases the seat.
    }
  }

  override async onReconnect(client: Client): Promise<void> {
    const playerId = this.seats.get(client.sessionId);
    if (playerId) await this.setConnected(playerId, true);
  }

  /** The client is gone for good — either a consented leave or an expired window. */
  override async onLeave(client: Client): Promise<void> {
    const playerId = this.seats.get(client.sessionId);
    if (!playerId) return;
    this.seats.delete(client.sessionId);
    await this.setConnected(playerId, false);
  }

  override onDispose(): void {
    this.clearTurnTimer();
  }

  private clearTurnTimer(): void {
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.turnTimerKey = null;
  }

  private async dispatch(client: Client, build: (playerId: string) => GameCommand): Promise<void> {
    const playerId = this.seats.get(client.sessionId);
    if (!playerId) {
      client.send('error', { message: '플레이어를 찾을 수 없습니다.' });
      return;
    }

    let result: CommandResult;
    try {
      result = await this.runtime.tryRun(build(playerId));
    } catch (cause) {
      // A malformed payload can fail before the rules ever see it.
      client.send('error', { message: cause instanceof Error ? cause.message : String(cause) });
      return;
    }

    if (Either.isLeft(result)) {
      client.send('error', { message: result.left.message });
      return;
    }
    this.broadcastState();
  }

  private async setConnected(playerId: string, connected: boolean): Promise<void> {
    const result = await this.runtime.tryRun(Command.setConnection(playerId, connected));
    if (Either.isLeft(result)) return;
    this.broadcastState();
  }

  /** Sends every client its own projection, then lets a bot take its turn. */
  private broadcastState(): void {
    const room = this.runtime.state();
    for (const client of this.clients) {
      client.send('state', { state: publicState(room, this.seats.get(client.sessionId) ?? null) });
    }
    this.scheduleTurn();
  }

  /**
   * Arms the auto-action for the seat the table is waiting on.
   *
   * A human gets until `turnEndsAt`, which the rules stamped; a bot gets a
   * short think. The wait is keyed so repeated broadcasts within one turn leave
   * the running timer alone — otherwise a bot would have its think restarted,
   * and re-arming on every state change would let a seat stall indefinitely.
   */
  private scheduleTurn(): void {
    const room = this.runtime.state();
    if (room.phase !== 'draft') {
      this.clearTurnTimer();
      return;
    }

    // A pending claim is a decision too, and it always belongs to a human: bots
    // settle their claims inside their own turn.
    const claim = room.pendingClaim;
    const seat = claim
      ? room.players.find((player) => player.id === claim.playerId)
      : room.players[room.currentPlayerIndex];
    if (!seat) {
      this.clearTurnTimer();
      return;
    }

    const waitingOnBot = seat.bot && !claim;
    const key = `${seat.id}:${claim ? 'claim' : 'turn'}:${room.turnEndsAt ?? 0}`;
    if (this.turnTimer && this.turnTimerKey === key) return;

    this.clearTurnTimer();
    const playerId = seat.id;
    const delay = waitingOnBot
      ? BOT_DELAY_MIN + Math.floor(Math.random() * BOT_DELAY_SPREAD)
      : this.humanDelayMs(room);

    this.turnTimerKey = key;
    this.turnTimer = this.clock.setTimeout(() => {
      this.turnTimer = null;
      this.turnTimerKey = null;

      // The game may have moved on during the wait — a claim resolving, the
      // game ending, or this seat no longer being the one to act. The re-check
      // runs inside the command's critical section, so nothing can slip in
      // between deciding and acting.
      void this.runtime
        .runWith((current) => this.autoAction(current, playerId, waitingOnBot))
        .then((outcome) => {
          if (Option.isNone(outcome)) return; // the turn moved on; nothing to do
          if (Either.isLeft(outcome.value)) {
            console.error(`auto turn failed in room ${this.roomId}:`, outcome.value.left.message);
            return;
          }
          this.broadcastState();
        })
        .catch((cause: unknown) => {
          console.error(`auto turn crashed in room ${this.roomId}:`, cause);
        });
    }, delay);
  }

  /**
   * What to do for a seat that ran out of time.
   *
   * Placing the drawn card is the least destructive choice that can be made on
   * someone's behalf: they keep the card and stay in the game. Declining to
   * claim is likewise reversible in spirit — the combo stays on the table for
   * whoever declares it next.
   */
  private autoAction(current: RoomState, playerId: string, waitingOnBot: boolean): GameCommand | null {
    if (current.phase !== 'draft') return null;

    if (current.pendingClaim) {
      if (current.pendingClaim.playerId !== playerId) return null;
      return Command.finishClaim(playerId);
    }
    if (current.players[current.currentPlayerIndex]?.id !== playerId) return null;
    if (waitingOnBot) return Command.botTurn(playerId);
    if (!current.drawn) return null;
    return Command.pick(playerId, current.drawn.id, null);
  }
}

export { RuleError };
