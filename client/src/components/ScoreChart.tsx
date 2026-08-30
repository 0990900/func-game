/**
 * Who pulled ahead, and when.
 *
 * A final total says who won; it does not say that someone led for forty turns
 * and lost it to one claim. The server samples every player's public score once
 * per turn because that shape cannot be recovered from the finished board, and
 * this is what it is for.
 *
 * Drawn as plain SVG. A chart library would be the largest dependency in the
 * client for four polylines, and this one has no interaction to speak of.
 *
 * Seat colours are borrowed from the containers. That is a reuse, not a clash:
 * there are no containers in this chart, and the four are already known to be
 * distinguishable from each other.
 */
import { containers } from '../../../src/core/cards.ts';
import { containerColor } from '../theme/tokens.ts';
import type { PublicState } from '../../../src/core/types.ts';

const WIDTH = 320;
const HEIGHT = 150;
const PAD_LEFT = 26;
const PAD_BOTTOM = 18;
const PAD_TOP = 8;
const PAD_RIGHT = 4;

/** Seat index -> line colour. Four seats, four container hues. */
const seatColor = (index: number): string => containerColor[containers[index % containers.length]!];

export function ScoreChart({ state }: { readonly state: PublicState }) {
  const log = state.scoreLog;
  if (log.length < 2) {
    return <p className="muted">두 턴이 지나면 점수 변화를 그래프로 보여줍니다.</p>;
  }

  const lastTurn = log[log.length - 1]!.turn;
  // The axis runs to the end of the game, so a lead read at turn 12 is not
  // redrawn to look like a lead at turn 60.
  const maxTurn = Math.max(lastTurn, state.progress.turnsTotal);
  const maxScore = Math.max(
    1,
    ...log.flatMap((sample) => Object.values(sample.totals)),
  );

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (turn: number): number => PAD_LEFT + (turn / maxTurn) * plotWidth;
  const y = (score: number): number => PAD_TOP + plotHeight - (score / maxScore) * plotHeight;

  // Round numbers on the axis rather than a fraction of whatever the leader has.
  const gridStep = maxScore <= 10 ? 5 : maxScore <= 30 ? 10 : maxScore <= 60 ? 20 : 25;
  const gridLines: number[] = [];
  for (let value = 0; value <= maxScore; value += gridStep) gridLines.push(value);

  return (
    <div className="score-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chartSummary(state)}>
        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT}
              y1={y(value)} y2={y(value)}
              className="chart-grid"
            />
            <text x={PAD_LEFT - 5} y={y(value) + 3} className="chart-label" textAnchor="end">{value}</text>
          </g>
        ))}

        <text x={PAD_LEFT} y={HEIGHT - 5} className="chart-label">1턴</text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 5} className="chart-label" textAnchor="end">
          {maxTurn}턴
        </text>

        {state.players.map((player, index) => {
          const points = log
            .map((sample) => `${x(sample.turn)},${y(sample.totals[player.id] ?? 0)}`)
            .join(' ');
          const isMe = player.id === state.me?.id;
          return (
            <polyline
              key={player.id}
              points={points}
              fill="none"
              stroke={seatColor(index)}
              strokeWidth={isMe ? 2.4 : 1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity={isMe ? 1 : 0.75}
            />
          );
        })}
      </svg>

      <ul className="chart-legend">
        {state.players.map((player, index) => (
          <li key={player.id} className={player.id === state.me?.id ? 'is-me' : undefined}>
            <span className="chart-swatch" style={{ background: seatColor(index) }} aria-hidden="true" />
            {player.name}{player.bot ? ' (Bot)' : ''}
            <b>{player.publicScore.total}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The chart in words, for anyone who cannot see it. */
function chartSummary(state: PublicState): string {
  const ranked = [...state.players].sort((a, b) => b.publicScore.total - a.publicScore.total);
  const parts = ranked.map((player, index) => `${index + 1}위 ${player.name} ${player.publicScore.total}점`);
  return `턴별 공개 점수 변화. 현재 ${parts.join(', ')}.`;
}
