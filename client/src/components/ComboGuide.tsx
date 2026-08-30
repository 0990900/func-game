/**
 * What every combo needs and what it pays. A reference, and only that.
 *
 * This panel used to track the player's progress as well, back when the table
 * could not show it. The play area now carries the whole ladder per player,
 * dimmed where it has not been reached, and marks the operations a typeclass
 * needs the moment you tap it — so repeating that here only gave a second
 * answer to a question already answered on the board, in a sheet you had to
 * open to see. What the table cannot show is the rules themselves: which
 * containers a combo is even possible in, and what it scores.
 */
import { comboDefinitions } from '../../../src/core/combos.ts';
import { containerMeta, operationMeta } from '../theme/meta.ts';
import type { ContainerName } from '../../../src/core/types.ts';

export function ComboGuide() {
  return (
    <div className="combo-guide">
      <p className="muted">
        컨테이너마다 기본 단계는 가장 높은 하나만 점수가 됩니다. 특수 조합은 따로 더해집니다.
        내가 어디까지 왔는지는 플레이 영역에서 볼 수 있습니다.
      </p>
      <ul className="combo-list">
        {comboDefinitions.map((definition) => (
          <li key={definition.name} className={`combo-item combo-item--${definition.family}`}>
            <span className="combo-name">
              {definition.name}
              <span className="combo-score">{definition.score}점</span>
            </span>
            <span className="combo-steps">
              {definition.requires.map((operation) => (
                <span key={operation} className="combo-step">
                  {operationMeta[operation]?.[0] ?? '·'} {operation}
                </span>
              ))}
            </span>
            {/* A base combo is open to every container; a special one is not,
                and that restriction is the rule worth stating. */}
            <span className="combo-where">
              {definition.containers.length === 4
                ? '모든 컨테이너'
                : definition.containers
                    .map((container) => `${containerMeta[container as ContainerName]?.symbol ?? ''} ${container}`)
                    .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
