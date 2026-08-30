import { Option } from 'effect';
import { actionOrder, goalScore, CARDS_PER_PLAYER, TURN_LIMIT_MS } from './rules.ts';
import { scorePlayer, utilityOperations } from './scoring.ts';
import type {
  FinalScore,
  Player,
  PlayerStatus,
  PublicState,
  Room,
  ScoreBreakdown,
} from './types.ts';

export function publicState(room: Room, viewerId: string | null | undefined): PublicState {
  const viewer = Option.fromNullable(room.players.find((p) => p.id === viewerId));
  const turnsCompleted = room.players.reduce((sum, player) => sum + player.playArea.length, 0);
  const scores = room.phase === 'finished' ? finalScores(room) : null;

  return Option.match(viewer, {
    onNone: () => project(room, null, turnsCompleted, scores),
    onSome: (player) => project(room, player, turnsCompleted, scores),
  });
}

function finalScores(room: Room): FinalScore[] {
  return room.players
    .map((p) => {
      const base = scorePlayer(p);
      const goal = goalScore(p);
      return {
        playerId: p.id,
        name: p.name,
        ...base,
        utilityKinds: utilityOperations(p.playArea).size,
        claims: p.claims,
        goal: p.goal,
        goalScore: goal,
        total: base.total + goal,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function project(
  room: Room,
  viewer: Player | null,
  turnsCompleted: number,
  scores: readonly FinalScore[] | null,
): PublicState {
  return {
    roomId: room.id,
    phase: room.phase,
    direction: room.direction,
    drawn: room.drawn,
    deckCount: room.deck.length,
    // Derived from the rules rather than restated: a change to the seat count
    // or the hand size moves the end of the game here too.
    progress: {
      turnsCompleted,
      turnsTotal: room.players.length * CARDS_PER_PLAYER,
      myCards: viewer?.playArea.length ?? 0,
      cardsPerPlayer: CARDS_PER_PLAYER,
    },
    turnEndsAt: room.phase === 'draft' ? room.turnEndsAt : null,
    turnLimitSeconds: Math.round(TURN_LIMIT_MS / 1000),
    scoreLog: room.scoreLog,
    hostPlayerId: room.hostPlayerId,
    me: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          goalOptions: room.phase === 'goal' ? viewer.goalOptions : [],
          goal: viewer.goal,
          isMyTurn:
            room.phase === 'draft'
            && room.players[room.currentPlayerIndex]?.id === viewer.id,
        }
      : null,
    currentPlayerId: room.phase === 'draft' ? room.players[room.currentPlayerIndex]?.id || null : null,
    turnOrder: actionOrder(room),
    market: room.market,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      connected: p.connected,
      playArea: p.playArea,
      claimCount: p.claims.length,
      claims: p.claims,
      cardCount: p.playArea.length,
      status: playerStatus(room, p),
      publicScore: publicScore(p),
    })),
    lastReveal: room.lastReveal,
    events: room.events.slice(-30).reverse(),
    scores,
  };
}

function publicScore(player: Player): ScoreBreakdown {
  const score = scorePlayer(player);
  return {
    comboScore: score.comboScore,
    utilityScore: score.utilityScore,
    claimScore: score.claimScore,
    total: score.total,
  };
}

function playerStatus(room: Room, player: Player): PlayerStatus {
  if (!player.connected) return 'disconnected';
  if (room.phase === 'goal') return player.goal ? 'ready' : 'choosing_goal';
  if (room.phase === 'draft') {
    if (room.players[room.currentPlayerIndex]?.id === player.id) return player.bot ? 'thinking' : 'playing';
    return 'waiting';
  }
  if (room.phase === 'finished') return 'finished';
  return 'lobby';
}
