import { Option } from 'effect';
import { comboKey, findCombos } from './combos.ts';
import { actionOrder, goalScore } from './rules.ts';
import { scorePlayer } from './scoring.ts';
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
      return { playerId: p.id, name: p.name, ...base, goalScore: goal, total: base.total + goal };
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
    round: room.round,
    pick: room.pick,
    direction: room.direction,
    progress: {
      roundsTotal: 3,
      picksPerRound: 5,
      turnsCompleted,
      turnsTotal: 60,
      myPicks: viewer?.playArea.length || 0,
      myPicksTotal: 15,
      turnsThisPick: room.turnsThisPick,
    },
    hostPlayerId: room.hostPlayerId,
    me: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          hand: viewer.hand,
          goalOptions: room.phase === 'goal' ? viewer.goalOptions : [],
          goal: viewer.goal,
          isMyTurn:
            room.phase === 'draft'
            && !room.pendingClaim
            && room.players[room.currentPlayerIndex]?.id === viewer.id,
          availableClaims:
            room.pendingClaim?.playerId === viewer.id
              ? findCombos(viewer.playArea).filter(
                  (combo) =>
                    room.pendingClaim!.keys.includes(comboKey(combo))
                    && !room.claimedCombos.includes(comboKey(combo)),
                )
              : [],
          canFinishClaim: room.pendingClaim?.playerId === viewer.id,
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
    if (room.pendingClaim?.playerId === player.id) return 'claiming';
    if (room.players[room.currentPlayerIndex]?.id === player.id) return player.bot ? 'thinking' : 'playing';
    return 'waiting';
  }
  if (room.phase === 'finished') return 'finished';
  return 'lobby';
}
