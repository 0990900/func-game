import { useState } from 'react';
import { ScoreChart } from './ScoreChart.tsx';
import { containerMeta } from '../theme/meta.ts';
import { groupScore } from '../../../src/core/scoring.ts';
import { actions } from '../store/gameStore.ts';
import { shareResultImage } from '../ui/resultImage.ts';
import type { FinalScore, PublicState } from '../../../src/core/types.ts';

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
            <Working score={score} />
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

/**
 * The working behind one player's total.
 *
 * A breakdown of four numbers says where the points came from; it does not say
 * which combos paid, what the secret goal even was, or why a utility pile worth
 * seven was worth seven. Those are the things a player needs to plan the next
 * game, and they are only knowable now that the game is over and the goals are
 * face up.
 *
 * A `<details>` rather than a panel: four expanded workings would bury the
 * standings, and the browser handles the disclosure for free.
 */
function Working({ score }: { readonly score: FinalScore }) {
  return (
    <details className="working">
      <summary>계산 근거</summary>

      <dl>
        <dt>조합 {score.comboScore}점</dt>
        <dd>
          {score.combos.length === 0 ? '완성한 조합이 없습니다.' : (
            <ul className="working-list">
              {[...score.combos]
                .sort((a, b) => b.score - a.score)
                .map((combo) => (
                  <li key={`${combo.container}:${combo.name}`}>
                    <span>
                      {containerMeta[combo.container]?.symbol ?? ''} {combo.container} {combo.name}
                    </span>
                    <b>{combo.score}</b>
                  </li>
                ))}
            </ul>
          )}
          {/* The rule that surprises people: a container pays for its best base
              tier only, so Functor stops paying the moment Apply is built. */}
          <p className="muted">컨테이너마다 기본 단계는 가장 높은 하나만 점수가 됩니다. 특수 조합은 따로 더해집니다.</p>
        </dd>

        <dt>Utility {score.utilityScore}점</dt>
        <dd>
          서로 다른 {score.utilityKinds}종을 모았습니다. 유틸리티는 장수가 아니라 종류 수로만 점수가 됩니다.
        </dd>

        <dt>Claim {score.claimScore}점</dt>
        <dd>
          {score.claimGroups.length === 0 ? '선언한 조합이 없습니다.' : (
            <>
              {/* One row per card that finished something. The bonus is a
                  property of the grouping, so the grouping is what is shown —
                  a flat list of keys could not explain the number above. */}
              <ul className="working-list">
                {score.claimGroups.map((group, index) => (
                  <li key={`${index}:${group.join()}`}>
                    <span className="working-claims">
                      {group.map((key) => (
                        <span key={key} className="chip">{key.replace(':', ' ')}</span>
                      ))}
                    </span>
                    <b>{groupScore(group.length)}</b>
                  </li>
                ))}
              </ul>
              <p className="muted">
                한 번에 선언한 것 중 n번째가 n점입니다. 한 장으로 여러 개를 몰아 완성할수록 유리합니다.
              </p>
            </>
          )}
        </dd>

        <dt>비밀 목표 {score.goalScore}점</dt>
        <dd>
          {score.goal
            ? (
              <>
                <b>{score.goal.name}</b> — {score.goal.text} (+{score.goal.score})
                <p className="muted">{score.goalScore > 0 ? '달성했습니다.' : '달성하지 못해 0점입니다.'}</p>
              </>
            )
            : '목표를 고르지 않았습니다.'}
        </dd>
      </dl>
    </details>
  );
}
