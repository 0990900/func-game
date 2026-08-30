export type ContainerName = 'Maybe' | 'Either' | 'List' | 'Task';

export type CardKind =
  | 'container-function'
  | 'operation-wildcard'
  | 'container-wildcard'
  | 'wildcard'
  | 'utility';

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
  | 'disconnect';

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

export interface PendingClaim {
  playerId: string;
  keys: string[];
}

export interface Player {
  id: string;
  name: string;
  bot: boolean;
  hand: Card[];
  playArea: Card[];
  goalOptions: Goal[];
  goal: Goal | null;
  /** Claimed combo keys, formatted `Container:Name`. */
  claims: string[];
  connected: boolean;
}

export interface Room {
  id: string;
  phase: Phase;
  round: number;
  pick: number;
  direction: Direction;
  hostPlayerId: string;
  players: Player[];
  deck: Card[];
  market: Card[];
  currentPlayerIndex: number;
  turnsThisPick: number;
  pendingClaim: PendingClaim | null;
  lastReveal: Reveal[];
  claimedCombos: string[];
  events: GameEvent[];
}

export type PlayerStatus =
  | 'disconnected'
  | 'ready'
  | 'choosing_goal'
  | 'claiming'
  | 'thinking'
  | 'playing'
  | 'waiting'
  | 'finished'
  | 'lobby';

export interface ScoreBreakdown {
  readonly comboScore: number;
  readonly utilityScore: number;
  readonly claimScore: number;
  readonly total: number;
}

export interface FinalScore extends ScoreBreakdown {
  readonly playerId: string;
  readonly name: string;
  readonly combos: readonly Combo[];
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
   * Combo keys this player has claimed, formatted `Container:Name`. Public:
   * every claim is announced in the event log as it happens.
   */
  readonly claims: readonly string[];
  readonly cardCount: number;
  readonly status: PlayerStatus;
  readonly publicScore: ScoreBreakdown;
}

export interface PublicProgress {
  readonly roundsTotal: number;
  readonly picksPerRound: number;
  readonly turnsCompleted: number;
  readonly turnsTotal: number;
  readonly myPicks: number;
  readonly myPicksTotal: number;
  readonly turnsThisPick: number;
}

export interface PublicMe {
  readonly id: string;
  readonly name: string;
  readonly hand: readonly Card[];
  readonly goalOptions: readonly Goal[];
  readonly goal: Goal | null;
  readonly isMyTurn: boolean;
  readonly availableClaims: readonly Combo[];
  readonly canFinishClaim: boolean;
}

export interface PublicState {
  readonly roomId: string;
  readonly phase: Phase;
  readonly round: number;
  readonly pick: number;
  readonly direction: Direction;
  readonly progress: PublicProgress;
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
