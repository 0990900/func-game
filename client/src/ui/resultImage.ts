/**
 * The final result as a PNG, for sharing outside the game.
 *
 * Drawn straight onto a canvas rather than by serialising the SVG chart. A
 * serialised SVG has to re-resolve its fonts inside an <img>, and Korean names
 * are exactly what would be dropped when that fails — a share image that
 * silently loses the players' names is worse than none.
 */
import { palette } from '../theme/tokens.ts';
import { scorePlot } from './scoreSeries.ts';
import type { FinalScore, PublicState } from '../../../src/core/types.ts';

const SCALE = 2;
const W = 900;
const H = 560;
const MARGIN = 36;

const FONT = '"Helvetica Neue", -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const font = (size: number, weight = 400): string => `${weight} ${size}px ${FONT}`;

/** Chart box inside the image. */
const CHART = { x: MARGIN, y: 128, w: 470, h: 344 };

export function renderResultImage(state: PublicState): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('캔버스를 만들 수 없습니다.'));
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = palette.accent;
  ctx.font = font(26, 800);
  ctx.fillText('FP Draft Game · 최종 결과', MARGIN, MARGIN + 20);

  ctx.fillStyle = palette.muted;
  ctx.font = font(13);
  ctx.fillText(
    `${state.progress.turnsTotal}턴 · ${state.players.length}인 · 함수형 타입클래스 카드 드래프트`,
    MARGIN,
    MARGIN + 44,
  );

  drawChart(ctx, state);
  drawStandings(ctx, state.scores ?? []);

  ctx.fillStyle = palette.muted;
  ctx.font = font(11);
  ctx.fillText('굵은 선이 나의 점수입니다. 선은 진행 중 공개 점수이고, 순위의 점수는 비밀 목표까지 더한 최종 점수입니다.', MARGIN, H - 22);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했습니다.'))),
      'image/png',
    );
  });
}

function drawChart(ctx: CanvasRenderingContext2D, state: PublicState): void {
  const plot = scorePlot(state);

  ctx.fillStyle = palette.text;
  ctx.font = font(14, 700);
  ctx.fillText('턴별 점수', CHART.x, CHART.y - 12);

  if (!plot.hasData) {
    ctx.fillStyle = palette.muted;
    ctx.font = font(13);
    ctx.fillText('기록된 점수 변화가 없습니다.', CHART.x, CHART.y + 24);
    return;
  }

  const x = (turn: number): number => CHART.x + (turn / plot.maxTurn) * CHART.w;
  const y = (score: number): number => CHART.y + CHART.h - (score / plot.maxScore) * CHART.h;

  ctx.font = font(11);
  for (const value of plot.gridLines) {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CHART.x, y(value));
    ctx.lineTo(CHART.x + CHART.w, y(value));
    ctx.stroke();

    ctx.fillStyle = palette.muted;
    ctx.textAlign = 'right';
    ctx.fillText(String(value), CHART.x - 6, y(value) + 4);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = palette.muted;
  ctx.fillText('1턴', CHART.x, CHART.y + CHART.h + 18);
  ctx.textAlign = 'right';
  ctx.fillText(`${plot.maxTurn}턴`, CHART.x + CHART.w, CHART.y + CHART.h + 18);
  ctx.textAlign = 'left';

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const series of plot.series) {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.isMe ? 3 : 2;
    ctx.globalAlpha = series.isMe ? 1 : 0.8;
    ctx.beginPath();
    series.points.forEach((point, index) => {
      const px = x(point.turn);
      const py = y(point.score);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawStandings(ctx: CanvasRenderingContext2D, scores: readonly FinalScore[]): void {
  const left = CHART.x + CHART.w + 40;
  const width = W - left - MARGIN;
  let y = CHART.y - 12;

  ctx.fillStyle = palette.text;
  ctx.font = font(14, 700);
  ctx.fillText('최종 순위', left, y);
  y += 20;

  for (const [index, score] of scores.entries()) {
    const rowHeight = 78;
    ctx.strokeStyle = index === 0 ? palette.accent : palette.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, y, width, rowHeight);

    ctx.fillStyle = index === 0 ? palette.accent : palette.muted;
    ctx.font = font(20, 800);
    ctx.fillText(String(index + 1), left + 14, y + 32);

    ctx.fillStyle = palette.text;
    ctx.font = font(16, 700);
    ctx.fillText(score.name, left + 44, y + 30);

    ctx.textAlign = 'right';
    ctx.font = font(22, 800);
    ctx.fillStyle = index === 0 ? palette.accent : palette.text;
    ctx.fillText(`${score.total}점`, left + width - 14, y + 32);
    ctx.textAlign = 'left';

    ctx.fillStyle = palette.muted;
    ctx.font = font(12);
    ctx.fillText(
      `조합 ${score.comboScore} · Utility ${score.utilityScore}`
      + ` · Claim ${score.claimScore} · 목표 ${score.goalScore}`,
      left + 44,
      y + 56,
    );

    y += rowHeight + 8;
  }
}

export type ShareOutcome = 'copied' | 'downloaded';

/**
 * Puts the result where the player can use it.
 *
 * Copying needs a secure context, which a game served over a LAN address is
 * not, and it needs a permission the browser may refuse. Saving the file always
 * works, so it is the fallback rather than an error — and the caller is told
 * which happened so it can say so.
 */
export async function shareResultImage(state: PublicState): Promise<ShareOutcome> {
  const blob = await renderResultImage(state);

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    } catch {
      // Refused, or not a secure context. Fall through and save it instead.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fp-draft-result.png';
  link.click();
  // Revoked on the next frame: revoking immediately can cancel the save.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
  return 'downloaded';
}
