/** Chrome around the table: claims, the secret goal, combos, score and the log. Stays DOM. */
import { ComboGuide } from './ComboGuide.tsx';
import { eventIcon, scoreSummary } from '../theme/meta.ts';
import { actions } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

function ClaimPanel({ state }: { readonly state: PublicState }) {
  const me = state.me;
  if (!me?.canFinishClaim) return null;

  return (
    <section className="panel claim-panel">
      <h2>새 조합 완성</h2>
      <p>Claim하면 1점을 얻습니다. 같은 조합은 게임 전체에서 한 번만 Claim할 수 있습니다.</p>
      <div className="actions">
        {me.availableClaims.map((combo) => (
          <button
            key={`${combo.container}:${combo.name}`}
            type="button"
            onClick={() => actions.claim(combo.container, combo.name)}
          >
            {combo.container} {combo.name} Claim
          </button>
        ))}
        <button type="button" className="secondary" onClick={actions.finishClaim}>
          건너뛰고 턴 넘기기
        </button>
      </div>
    </section>
  );
}

/**
 * The player's own secret goal. It was chosen once at the start and then never
 * shown again, so there was no way to remember what you were playing towards.
 * Only the viewer's own goal is in publicState, so this cannot leak.
 */
function SecretGoal({ state }: { readonly state: PublicState }) {
  const goal = state.me?.goal;
  if (!goal) return null;

  return (
    <section className="panel goal-panel">
      <h2>내 비밀 목표</h2>
      <b className="goal-name">{goal.name}</b>
      <p>{goal.text}</p>
      <p className="muted">달성하면 게임 종료 시 +{goal.score}점. 나만 볼 수 있습니다.</p>
    </section>
  );
}

function EventLog({ state }: { readonly state: PublicState }) {
  return (
    <section className="panel">
      <h2>진행 기록</h2>
      <ul className="event-log">
        {state.events.map((event) => (
          <li key={event.id}>
            <span aria-hidden="true">{eventIcon(event.type)}</span>
            {event.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Hud({ state }: { readonly state: PublicState }) {
  const mySeat = state.players.find((player) => player.id === state.me?.id);

  return (
    <>
      <ClaimPanel state={state} />
      <SecretGoal state={state} />
      {mySeat && (
        <section className="panel">
          <h2>내 점수</h2>
          <b className="score-pill score-pill--large">{mySeat.publicScore.total}점</b>
          <p className="muted">{scoreSummary(mySeat.publicScore)}</p>
        </section>
      )}
      <ComboGuide playArea={mySeat?.playArea ?? []} />
      <EventLog state={state} />
    </>
  );
}
