export type ContainerName = 'Maybe' | 'Either' | 'List' | 'Task';

export type CardKind =
  | 'container-function'
  | 'operation-wildcard'
  | 'container-wildcard'
  | 'wildcard'
  | 'utility'
  /** Reverses the turn order when drawn. Never reaches a play area. */
  | 'order-reverse';

export interface Card {
  readonly id: string;
  readonly kind: CardKind;
  readonly container: ContainerName | '*' | null;
  readonly operation: string;
  readonly label: string;
}

export type GoalId =
  | 'specialist'
  | 'generalist'
  | 'purist'
  | 'utility-belt'
  | 'polyglot'
  | 'collector';

export interface Goal {
  readonly id: GoalId;
  readonly name: string;
  readonly text: string;
  readonly score: number;
}

export type ComboFamily = 'base' | 'special';

export interface ComboDefinition {
  readonly name: string;
  readonly family: ComboFamily;
  readonly score: number;
  readonly containers: readonly ContainerName[];
  readonly requires: readonly string[];
}

/** A combo definition resolved against one container. */
export interface Combo extends ComboDefinition {
  readonly container: ContainerName;
}

export type Phase = 'lobby' | 'goal' | 'draft' | 'finished';

export type Direction = 'left' | 'right';

export type EventType =
  | 'join'
  | 'game_start'
  | 'turn_order'
  | 'goal_ready'
  | 'round_start'
  | 'claim_ready'
  | 'claim'
  | 'market'
  | 'pick'
  | 'pass'
  | 'game_end'
  | 'reconnect'
  | 'disconnect'
  | 'reverse';

export interface GameEvent {
  readonly id: string;
  readonly type: EventType;
  readonly message: string;
  readonly playerId: string | null;
}

export interface Reveal {
  readonly playerId: string;
  readonly playerName: string;
  readonly card: Card;
}

export interface Player {
  id: string;
  name: string;
  bot: boolean;
  playArea: Card[];
  goalOptions: Goal[];
  goal: Goal | null;
  /**
   * Claimed combo keys, formatted `Container:Name`, grouped by the turn they
   * were declared on.
   *
   * Grouped rather than flat because the bonus depends on it: three combos
   * finished on one card pay six, three finished apart pay three, and a flat
   * list cannot tell those apart. Both the claim list and the claim score are
   * read off this, so neither can drift from it.
   */
  claimGroups: string[][];
  connected: boolean;
}

/** A player's running public total, sampled once per completed turn. */
export interface ScoreSample {
  /** Cards on the table when the sample was taken: turn 1 is the first play. */
  readonly turn: number;
  /** playerId -> public total (secret goals excluded, as always). */
  readonly totals: Readonly<Record<string, number>>;
}

export interface Room {
  id: string;
  phase: Phase;
  direction: Direction;
  hostPlayerId: string;
  players: Player[];
  deck: Card[];
  market: Card[];
  currentPlayerIndex: number;
  /** The card the player on turn has drawn and not yet placed. */
  drawn: Card | null;
  /** Set when a reverse card came up; applied once this turn resolves. */
  reversePending: boolean;
  discard: Card[];
  lastReveal: Reveal[];
  claimedCombos: string[];
  events: GameEvent[];
  /**
   * When the seat on turn runs out of time, as epoch milliseconds. The rules
   * stamp it; the server owns the timer that fires on it.
   */
  turnEndsAt: number | null;
  /** Public score per player after each turn, oldest first. */
  scoreLog: ScoreSample[];
}

export type PlayerStatus =
  | 'disconnected'
  | 'ready'
  | 'choosing_goal'
  | 'thinking'
  | 'playing'
  | 'waiting'
  | 'finished'
  | 'lobby';

export interface ScoreBreakdown {
  readonly comboScore: number;
  readonly utilityScore: number;
  readonly claimScore: number;
  /** Holding one operation across several containers — see `scoreInstances`. */
  readonly instanceScore: number;
  readonly total: number;
}

/** One operation, and the containers a player holds a printed card of it for. */
export interface InstanceRow {
  readonly operation: string;
  /** The containers whose type really has this operation. */
  readonly possible: readonly ContainerName[];
  /** The ones this player holds a printed card for. */
  readonly held: readonly ContainerName[];
  readonly score: number;
}

/**
 * The final score, and how it was arrived at.
 *
 * A total tells a player they lost; the working tells them why, which is what
 * they need to play differently next time. Secret goals are secret only while
 * the game runs, so the goal itself is revealed here alongside its score.
 */
export interface FinalScore extends ScoreBreakdown {
  readonly playerId: string;
  readonly name: string;
  /** The combos that actually paid — the highest base tier per container, plus specials. */
  readonly combos: readonly Combo[];
  /** How many different utility operations were held. The score follows from this alone. */
  readonly utilityKinds: number;
  /** Every operation held in more than one container, and what it paid. */
  readonly instances: readonly InstanceRow[];
  /** Combos this player declared, grouped by the turn each group was declared on. */
  readonly claimGroups: ReadonlyArray<readonly string[]>;
  /** Revealed now that the game is over. Null if the player never chose one. */
  readonly goal: Goal | null;
  readonly goalScore: number;
}

export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly bot: boolean;
  readonly connected: boolean;
  readonly playArea: readonly Card[];
  readonly claimCount: number;
  /**
   * Combo keys this player has claimed, grouped by the turn each group was
   * declared on. Public: every claim is announced in the event log as it
   * happens, and the grouping is what the bonus is computed from.
   */
  readonly claimGroups: ReadonlyArray<readonly string[]>;
  readonly cardCount: number;
  readonly status: PlayerStatus;
  readonly publicScore: ScoreBreakdown;
}

/**
 * How far the game has run and how it ends.
 *
 * The old shape carried rounds and picks, which the shared-draw rules no longer
 * have: every seat draws one card on its turn until each has `cardsPerPlayer`.
 * Those fields reported a hardcoded 3 rounds of 5 picks against a pick counter
 * that ran to 60, so the header showed impossible readings like `P23/5`.
 */
export interface PublicProgress {
  /** Cards played across the table so far. */
  readonly turnsCompleted: number;
  /** Cards that will be played in total: seats x cardsPerPlayer. */
  readonly turnsTotal: number;
  /** Cards the viewer has played. */
  readonly myCards: number;
  /** Cards each player ends with — the real end condition. */
  readonly cardsPerPlayer: number;
}

export interface PublicMe {
  readonly id: string;
  readonly name: string;
  readonly goalOptions: readonly Goal[];
  readonly goal: Goal | null;
  readonly isMyTurn: boolean;
}

export interface PublicState {
  readonly roomId: string;
  readonly phase: Phase;
  /** Which way the turn passes. A reverse card flips it. */
  readonly direction: Direction;
  /** The card on offer to the player on turn. Face up to everyone. */
  readonly drawn: Card | null;
  readonly deckCount: number;
  readonly progress: PublicProgress;
  /** Epoch ms the seat on turn must act by, so a client can count it down. */
  readonly turnEndsAt: number | null;
  /** Seconds a seat gets, so the countdown knows what a full bar means. */
  readonly turnLimitSeconds: number;
  /** Public score per player after each turn, for the score chart. */
  readonly scoreLog: readonly ScoreSample[];
  readonly hostPlayerId: string;
  readonly me: PublicMe | null;
  readonly currentPlayerId: string | null;
  readonly turnOrder: readonly string[];
  readonly market: readonly Card[];
  readonly players: readonly PublicPlayer[];
  readonly lastReveal: readonly Reveal[];
  readonly events: readonly GameEvent[];
  readonly scores: readonly FinalScore[] | null;
}
