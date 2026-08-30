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
  /** Watch without taking a seat: no actions, no score, not counted as a player. */
  readonly observe?: boolean;
}

interface PickMessage { readonly cardId: string; readonly marketCardId?: string | null }
interface GoalMessage { readonly goalId: string }
interface KickMessage { readonly playerId: string }

export class DraftRoom extends Room {
  /**
   * Seats are capped at four by the rules; this cap is for connections, and
   * has to leave room for people watching. A join past the fourth seat becomes
   * an observer rather than being turned away.
   */
  override maxClients = 16;

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
   * Sessions watching without a seat. Counted rather than inferred from
   * `clients.length - seats.size`: during `onJoin` the arriving client is not
   * in `clients` yet, so the inference was short by one exactly when it was
   * being published.
   */
  private readonly observers = new Set<string>();
  /**
   * The one pending auto-action for whoever the table is waiting on: a bot
   * thinking, or a human's turn clock running out. Bots and humans differ only
   * in how long the wait is, so they share the timer rather than racing two.
   */
  private turnTimer: Delayed | null = null;
  /** Identifies the wait the timer was armed for, so a re-broadcast never resets it. */
  private turnTimerKey: string | null = null;
  /** What the lobby was last told, so an unchanged room is not republished. */
  private metadataKey = '';
  /**
   * Metadata writes, in call order. They are fired and not awaited, so two of
   * them racing could leave an older record as the final one — with the key
   * already updated, nothing would come along to correct it.
   */
  private metadataWrite: Promise<unknown> = Promise.resolve();

  private get runtime(): RoomRuntime {
    if (!this.game) throw new Error('room used before onCreate');
    return this.game;
  }

  override onCreate(options: JoinOptions): void {
    this.game = createRoomRuntime(options?.name ?? 'Player');
    this.autoDispose = true;
    this.publishMetadata();

    this.onMessage('start_game', (client) => this.dispatch(client, Command.startGame));
    this.onMessage('restart_game', (client) => this.dispatch(client, Command.restartGame));
    this.onMessage('kick_player', (client, message: KickMessage) =>
      void this.kick(client, message?.playerId));
    this.onMessage('choose_goal', (client, message: GoalMessage) =>
      this.dispatch(client, (playerId) => Command.chooseGoal(playerId, message?.goalId)));
    this.onMessage('pick', (client, message: PickMessage) =>
      this.dispatch(client, (playerId) => Command.pick(playerId, message?.cardId, message?.marketCardId ?? null)));
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    // Someone who asked to watch is never seated, whatever the room looks like.
    // Checking the empty-room case first sat an observer in the host's chair
    // the moment the last player had left.
    if (options?.observe) {
      // Nothing to do: an observer is a client with no seat.
    } else if (this.seats.size === 0 && this.runtime.state().phase === 'lobby') {
      // The room is created with its host already seated, so the first player
      // to arrive takes that chair — the creator, or whoever comes after the
      // room has emptied out but observers kept it alive.
      //
      // Under their own name. Mapping a new session onto the existing host
      // Player without renaming it handed the arriving player the previous
      // host's identity, and their score with it. Restricted to the lobby for
      // the same reason: mid-game that chair has a board and a place in the
      // turn order that belong to someone else.
      const hostId = this.runtime.state().hostPlayerId;
      await this.runtime.tryRun(Command.renamePlayer(hostId, options?.name ?? 'Player'));
      this.seats.set(client.sessionId, hostId);
    } else {
      const result = await this.runtime.tryRun(Command.joinRoom(options?.name ?? 'Player'));
      // A full or already-started room is not a reason to turn someone away:
      // they watch instead, which is what they would have had to do anyway.
      if (Either.isRight(result)) this.seats.set(client.sessionId, result.right!.id);
    }
    // An observer is simply a client with no seat. Everything downstream keys
    // off the seat map, so there is nothing else to say no to.
    if (!this.seats.has(client.sessionId)) this.observers.add(client.sessionId);
    this.publishMetadata();
    this.broadcastState();
  }

  /**
   * What the lobby list shows about this room without joining it.
   *
   * Colyseus only carries metadata to `getAvailableRooms`, so this is the whole
   * of what a player can know before deciding to come in.
   */
  private publishMetadata(): void {
    const room = this.game ? this.runtime.state() : null;
    if (!room) return;
    const host = room.players.find((player) => player.id === room.hostPlayerId);
    const metadata = {
      host: host?.name ?? 'Player',
      phase: room.phase,
      // Seats a person holds. The rest are bots, filled in when the game starts.
      humans: this.seats.size,
      seats: room.players.length,
      observers: this.observers.size,
    };

    // This runs on every broadcast, which is every turn, and the room is
    // usually the same room it was: republishing an identical record is churn.
    const key = JSON.stringify(metadata);
    if (key === this.metadataKey) return;
    this.metadataKey = key;
    this.metadataWrite = this.metadataWrite
      .then(() => this.setMetadata(metadata))
      .catch((cause: unknown) => {
        // The lobby showing a stale room is not worth failing a join over.
        console.error(`room metadata failed in ${this.roomId}:`, cause);
      });
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
    if (!playerId) {
      // An observer leaving changes the count the lobby shows, and nothing else.
      if (this.observers.delete(client.sessionId)) this.publishMetadata();
      return;
    }
    this.seats.delete(client.sessionId);
    await this.setConnected(playerId, false);
    this.publishMetadata();
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
      client.send('error', { message: '관전 중에는 게임에 참여할 수 없습니다.' });
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

  /**
   * Removes a player at the host's request, and closes their connection.
   *
   * The rules take the seat away; this has to take the socket away too, or the
   * client sits in a room it is no longer part of, watching a game it cannot
   * act in and never being told why.
   */
  private async kick(client: Client, targetId: string | undefined): Promise<void> {
    const hostId = this.seats.get(client.sessionId);
    if (!hostId || !targetId) return;

    const result = await this.runtime.tryRun(Command.kickPlayer(hostId, targetId));
    if (Either.isLeft(result)) {
      client.send('error', { message: result.left.message });
      return;
    }

    for (const [sessionId, playerId] of this.seats) {
      if (playerId !== targetId) continue;
      this.seats.delete(sessionId);
      const kicked = this.clients.find((candidate) => candidate.sessionId === sessionId);
      // Consented, so the reconnection window never opens: they were asked to
      // leave, and holding their seat open would defeat the point.
      kicked?.leave(4000);
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
    this.publishMetadata();
    // `turnEndsAt` is stamped against the server's clock, so the server says
    // what time it is when it sends. A client that is a minute fast would
    // otherwise count a turn down a minute early.
    const serverNow = Date.now();
    for (const client of this.clients) {
      client.send('state', {
        state: publicState(room, this.seats.get(client.sessionId) ?? null),
        serverNow,
      });
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

    const seat = room.players[room.currentPlayerIndex];
    if (!seat) {
      this.clearTurnTimer();
      return;
    }

    const waitingOnBot = seat.bot;
    const key = `${seat.id}:${room.turnEndsAt ?? 0}`;
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
   * someone's behalf: they keep the card and stay in the game.
   */
  private autoAction(current: RoomState, playerId: string, waitingOnBot: boolean): GameCommand | null {
    if (current.phase !== 'draft') return null;
    if (current.players[current.currentPlayerIndex]?.id !== playerId) return null;
    if (waitingOnBot) return Command.botTurn(playerId);
    if (!current.drawn) return null;
    return Command.pick(playerId, current.drawn.id, null);
  }
}

export { RuleError };
