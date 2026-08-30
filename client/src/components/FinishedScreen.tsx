import { useState } from 'react';
import { ScoreChart } from './ScoreChart.tsx';
import { actions } from '../store/gameStore.ts';
import { shareResultImage } from '../ui/resultImage.ts';
import type { PublicState } from '../../../src/core/types.ts';

export function FinishedScreen({ state }: { readonly state: PublicState }) {
  const scores = state.scores ?? [];
  const [share, setShare] = useState<string | null>(null);
  // Only the host can restart, the same way only the host can start.
  const isHost = state.me?.id === state.hostPlayerId;

  const onShare = async (): Promise<void> => {
    setShare('이미지를 만드는 중…');
    try {
      const outcome = await shareResultImage(state);
      setShare(outcome === 'copied'
        ? '결과 이미지를 클립보드에 복사했습니다.'
        : '클립보드를 쓸 수 없어 이미지 파일로 저장했습니다.');
    } catch (cause) {
      setShare(cause instanceof Error ? cause.message : '이미지를 만들지 못했습니다.');
    }
  };

  return (
    <section className="panel">
      <h2>최종 점수</h2>

      {/* The game is over, so the chart is the whole story of it: the totals
          below say who won, the lines say how it went. */}
      <ScoreChart state={state} />

      <ol className="score-list">
        {scores.map((score, index) => (
          <li key={score.playerId} className={score.playerId === state.me?.id ? 'is-me' : undefined}>
            <span className="rank">{index + 1}</span>
            <b>{score.name}</b>
            <span className="total">{score.total}점</span>
            <span className="muted">
              조합 {score.comboScore} · Utility {score.utilityScore} · Claim {score.claimScore} · 비밀 목표 {score.goalScore}
            </span>
          </li>
        ))}
      </ol>

      <div className="actions">
        {/* Again with these people, rather than everyone re-entering a code. */}
        {isHost && (
          <button type="button" onClick={() => actions.restartGame()}>같은 인원으로 재시작</button>
        )}
        <button type="button" className="secondary" onClick={() => void onShare()}>결과 이미지 복사</button>
        <button type="button" className="secondary" onClick={() => void actions.leave()}>나가기</button>
      </div>
      {!isHost && <p className="muted">방장이 재시작하면 같은 인원으로 새 게임이 시작됩니다.</p>}
      {/* Polite: the result is already on screen, so this is a confirmation,
          not something to interrupt a reader with. */}
      {share && <p className="muted" role="status" aria-live="polite">{share}</p>}
    </section>
  );
}
