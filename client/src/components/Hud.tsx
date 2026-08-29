/** Chrome around the table: claims, combo hints, score and the event log. Stays DOM. */
import { comboDefinitions, coveredOperations } from '../../../src/core/combos.ts';
import { containers } from '../../../src/core/cards.ts';
import { containerMeta, eventIcon, operationMeta, scoreSummary } from '../theme/meta.ts';
import { actions } from '../store/gameStore.ts';
import type { PublicState } from '../../../src/core/types.ts';

const MONAD_REQUIRES = comboDefinitions.find((combo) => combo.name === 'Monad')!.requires;

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

/** Shows how close each container is to Monad, using the rules' own matching. */
function ComboProgress({ state }: { readonly state: PublicState }) {
  const playArea = state.players.find((player) => player.id === state.me?.id)?.playArea ?? [];

  return (
    <section className="panel">
      <h2>조합 진행</h2>
      {containers.map((container) => {
        const covered = coveredOperations(playArea, container, MONAD_REQUIRES);
        return (
          <div key={container} className="combo-row">
            <span className={`combo-container card--${containerMeta[container].theme}`}>
              {containerMeta[container].symbol} {container}
            </span>
            <div>
              {MONAD_REQUIRES.map((operation) => (
                <span
                  key={operation}
                  className={`combo-step${covered.has(operation) ? ' complete' : ''}`}
                >
                  {operationMeta[operation]?.[0]} {operation}
                </span>
              ))}
            </div>
          </div>
        );
      })}
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
      {mySeat && (
        <section className="panel">
          <h2>내 점수</h2>
          <b className="score-pill score-pill--large">{mySeat.publicScore.total}점</b>
          <p className="muted">{scoreSummary(mySeat.publicScore)}</p>
        </section>
      )}
      <ComboProgress state={state} />
      <EventLog state={state} />
    </>
  );
}
