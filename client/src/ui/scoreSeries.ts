/**
 * The score log, shaped for drawing.
 *
 * Two things draw it — the SVG chart in the app and the PNG the result is
 * shared as — and they must agree. Anything they both need to decide (which
 * colour a seat is, how tall the axis goes, where the game ends) is decided
 * once, here.
 */
import { containers } from '../../../src/core/cards.ts';
import { containerColor } from '../theme/tokens.ts';
import type { PublicState } from '../../../src/core/types.ts';

export interface ScoreSeries {
  readonly playerId: string;
  readonly label: string;
  readonly color: string;
  readonly isMe: boolean;
  /**
   * What to print beside the name. The lines are public score, which is all
   * anyone knew during play; once the game is over the secret goal is added and
   * the standings show that instead. Printing the public total there too made
   * the same player show two different numbers with nothing to explain it.
   */
  readonly total: number;
  /** True once the total includes a revealed secret goal. */
  readonly isFinal: boolean;
  /** One point per completed turn, oldest first. */
  readonly points: ReadonlyArray<{ readonly turn: number; readonly score: number }>;
}

export interface ScorePlot {
  readonly series: readonly ScoreSeries[];
  /** The axis runs to the end of the game, not to the last sample: a lead read
   *  at turn twelve should not be redrawn to look like a lead at turn sixty. */
  readonly maxTurn: number;
  readonly maxScore: number;
  /** Round numbers for the horizontal rules, always including zero. */
  readonly gridLines: readonly number[];
  readonly hasData: boolean;
}

/** Seat index -> line colour. Four seats, four container hues; no containers
 *  appear in a score chart, so the reuse cannot be misread. */
export const seatColor = (index: number): string =>
  containerColor[containers[index % containers.length]!];

export function scorePlot(state: PublicState): ScorePlot {
  const log = state.scoreLog;
  const finals = new Map((state.scores ?? []).map((score) => [score.playerId, score.total]));
  const lastTurn = log.length > 0 ? log[log.length - 1]!.turn : 0;
  const maxTurn = Math.max(1, lastTurn, state.progress.turnsTotal);
  const maxScore = Math.max(1, ...log.flatMap((sample) => Object.values(sample.totals)));

  const step = maxScore <= 10 ? 5 : maxScore <= 30 ? 10 : maxScore <= 60 ? 20 : 25;
  const gridLines: number[] = [];
  for (let value = 0; value <= maxScore; value += step) gridLines.push(value);

  return {
    maxTurn,
    maxScore,
    gridLines,
    hasData: log.length >= 2,
    series: state.players.map((player, index) => ({
      playerId: player.id,
      label: `${player.name}${player.bot ? ' (Bot)' : ''}`,
      color: seatColor(index),
      isMe: player.id === state.me?.id,
      total: finals.get(player.id) ?? player.publicScore.total,
      isFinal: finals.has(player.id),
      points: log.map((sample) => ({ turn: sample.turn, score: sample.totals[player.id] ?? 0 })),
    })),
  };
}

/** The standings in words, for anyone who cannot see the chart. */
export function standingsSummary(state: PublicState): string {
  const ranked = [...state.players].sort((a, b) => b.publicScore.total - a.publicScore.total);
  const parts = ranked.map((player, index) => `${index + 1}위 ${player.name} ${player.publicScore.total}점`);
  return `턴별 공개 점수 변화. 현재 ${parts.join(', ')}.`;
}
