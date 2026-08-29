import { actions } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

export function GoalScreen({ state }: { readonly state: PublicState }) {
  const options = state.me?.goalOptions ?? [];

  if (state.me?.goal || options.length === 0) {
    return (
      <section className="panel">
        <h2>비밀 목표</h2>
        <p>선택을 마쳤습니다. 다른 플레이어를 기다리는 중…</p>
        <ul className="player-list">
          {state.players.map((player) => (
            <li key={player.id}>
              <b>{player.name}</b>
              <span className="pill">{player.status === 'ready' ? '선택 완료' : '선택 중…'}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>비밀 목표를 선택하세요</h2>
      <p>목표는 나만 볼 수 있고, 점수는 게임이 끝날 때 공개됩니다.</p>
      <div className="grid">
        {options.map((goal) => (
          <button key={goal.id} type="button" className="goal-card" onClick={() => actions.chooseGoal(goal.id)}>
            <b>{goal.name}</b>
            <span>{goal.text}</span>
            <span className="goal-score">+{goal.score}점</span>
          </button>
        ))}
      </div>
    </section>
  );
}
