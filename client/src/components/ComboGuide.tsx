/**
 * What can be built, what it pays, and how close the player is to each.
 *
 * The old panel only tracked the base ladder up to Monad, which left the four
 * special combos — the ones worth the most — invisible: nothing told a player
 * that List wants reduce and traverse, or that only Maybe can reach
 * Alternative. Everything the rules score is listed here, derived from the
 * combo definitions rather than restated, so a new combo shows up on its own.
 */
import { comboDefinitions, coveredOperations } from '../../../src/core/combos.ts';
import { containerMeta, operationMeta } from '../theme/meta.ts';
import type { Card, ComboDefinition, ContainerName } from '../../../src/core/types.ts';

interface Row {
  readonly key: string;
  readonly container: ContainerName;
  readonly definition: ComboDefinition;
  readonly covered: ReadonlySet<string>;
  readonly complete: boolean;
}

/** Every combo reachable in this container, cheapest first, with progress. */
function rowsFor(container: ContainerName, playArea: readonly Card[]): Row[] {
  return comboDefinitions
    .filter((definition) => definition.containers.includes(container))
    .map((definition) => {
      const covered = coveredOperations(playArea, container, definition.requires);
      return {
        key: `${container}:${definition.name}`,
        container,
        definition,
        covered,
        complete: covered.size === definition.requires.length,
      };
    });
}

function ComboRow({ row }: { readonly row: Row }) {
  const { definition, covered, complete } = row;
  return (
    <li className={`combo-item${complete ? ' is-complete' : ''}`}>
      <span className="combo-name">
        {definition.name}
        <span className="combo-score">{definition.score}점</span>
      </span>
      <span className="combo-steps">
        {definition.requires.map((operation) => (
          <span key={operation} className={`combo-step${covered.has(operation) ? ' complete' : ''}`}>
            {operationMeta[operation]?.[0] ?? '·'} {operation}
          </span>
        ))}
      </span>
    </li>
  );
}

export function ComboGuide({ playArea }: { readonly playArea: readonly Card[] }) {
  return (
    <section className="panel">
      <h2>조합 진행</h2>
      <p className="muted">
        컨테이너마다 기본 단계는 가장 높은 하나만 점수가 됩니다. 특수 조합은 따로 더해집니다.
      </p>
      {(Object.keys(containerMeta) as ContainerName[]).map((container) => {
        const rows = rowsFor(container, playArea);
        return (
          <div key={container} className="combo-group">
            <h3 className={`combo-container card--${containerMeta[container].theme}`}>
              {containerMeta[container].symbol} {container}
            </h3>
            <ul className="combo-list">
              {rows.map((row) => <ComboRow key={row.key} row={row} />)}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
