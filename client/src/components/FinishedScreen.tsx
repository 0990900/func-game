import { actions } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

export function FinishedScreen({ state }: { readonly state: PublicState }) {
  const scores = state.scores ?? [];

  return (
    <section className="panel">
      <h2>최종 점수</h2>
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
        <button type="button" onClick={() => void actions.leave()}>새 게임</button>
      </div>
    </section>
  );
}
