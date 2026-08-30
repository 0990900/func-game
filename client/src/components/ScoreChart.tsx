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
 */
import { scorePlot, standingsSummary } from '../ui/scoreSeries.ts';
import type { PublicState } from '../../../src/core/types.ts';

const WIDTH = 320;
const HEIGHT = 150;
const PAD_LEFT = 26;
const PAD_BOTTOM = 18;
const PAD_TOP = 8;
const PAD_RIGHT = 4;

export function ScoreChart({ state }: { readonly state: PublicState }) {
  const plot = scorePlot(state);
  if (!plot.hasData) {
    return <p className="muted">두 턴이 지나면 점수 변화를 그래프로 보여줍니다.</p>;
  }

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (turn: number): number => PAD_LEFT + (turn / plot.maxTurn) * plotWidth;
  const y = (score: number): number => PAD_TOP + plotHeight - (score / plot.maxScore) * plotHeight;

  return (
    <div className="score-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={standingsSummary(state)}>
        {plot.gridLines.map((value) => (
          <g key={value}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(value)} y2={y(value)} className="chart-grid" />
            <text x={PAD_LEFT - 5} y={y(value) + 3} className="chart-label" textAnchor="end">{value}</text>
          </g>
        ))}

        <text x={PAD_LEFT} y={HEIGHT - 5} className="chart-label">1턴</text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 5} className="chart-label" textAnchor="end">
          {plot.maxTurn}턴
        </text>

        {plot.series.map((series) => (
          <polyline
            key={series.playerId}
            points={series.points.map((point) => `${x(point.turn)},${y(point.score)}`).join(' ')}
            fill="none"
            stroke={series.color}
            strokeWidth={series.isMe ? 2.4 : 1.4}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={series.isMe ? 1 : 0.75}
          />
        ))}
      </svg>

      <ul className="chart-legend">
        {plot.series.map((series) => (
          <li key={series.playerId} className={series.isMe ? 'is-me' : undefined}>
            <span className="chart-swatch" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
            <b>{series.total}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
