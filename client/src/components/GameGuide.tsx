/**
 * How the game works, on the way in.
 *
 * The point of this game is to learn the typeclass ladder, and a player who has
 * to discover the rules by losing learns the rules instead. The combo table is
 * the same one the in-game sheet shows — derived from the definitions, so it
 * cannot drift from what actually scores.
 *
 * Collapsed by default. Someone coming back for their fourth game should not
 * have to scroll past the rules to reach the room list.
 */
import { comboDefinitions } from '../../../src/core/combos.ts';
import { containers, createDeck, utilities } from '../../../src/core/cards.ts';
import { containerMeta, operationMeta } from '../theme/meta.ts';
import type { ContainerName } from '../../../src/core/types.ts';

export function GameGuide() {
  return (
    <details className="guide">
      <summary>게임 방법과 점수 규칙</summary>

      <h3>한 판의 흐름</h3>
      <ol className="guide-steps">
        <li>네 명이 함께 합니다. 사람이 모자라면 빈 자리를 Bot이 채웁니다.</li>
        <li>
          게임이 시작되면 비밀 목표를 하나 고릅니다. 나만 볼 수 있고, 달성했다면 게임이 끝날 때
          점수가 더해집니다.
        </li>
        <li>내 턴이 되면 덱에서 카드 한 장이 뽑힙니다. 그 한 장을 어떻게 쓸지만 정하면 됩니다.</li>
        <li>
          뽑은 카드를 내 플레이 영역에 놓거나, 시장에 있는 카드 한 장과 바꿔 옵니다. 어느 쪽을
          골라도 턴은 다음 사람에게 넘어갑니다.
        </li>
        <li>
          키보드로도 고를 수 있습니다. <b>1</b>은 뽑은 카드, <b>2~5</b>는 시장 카드이고, 같은 키를
          한 번 더 누르면 확정됩니다.
        </li>
        <li>한 턴은 30초입니다. 시간이 다 되면 뽑은 카드가 그대로 놓입니다.</li>
        <li>각자 15장을 놓으면 게임이 끝납니다. 네 명을 합쳐 60턴입니다.</li>
      </ol>

      <h3>카드</h3>
      <p>
        카드는 대부분 <b>Maybe.map</b>처럼 컨테이너와 연산이 짝지어져 있습니다. 어떤 연산을
        가지고 있는지는 컨테이너마다 다릅니다.
      </p>
      <ul className="guide-containers">
        {containers.map((container) => (
          <li key={container}>
            <b className={`card--${containerMeta[container as ContainerName]?.theme}`}>
              {containerMeta[container as ContainerName]?.symbol} {container}
            </b>
            <span className="muted">{containerOperations(container).join(' · ')}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        조커는 모자란 자리를 대신 채워 줍니다. 다만 <b>조커만으로 만든 조합은 Claim할 수 없습니다.</b>{' '}
        그 컨테이너의 진짜 카드가 적어도 한 장은 있어야 합니다.
      </p>
      <p className="muted">
        유틸리티 카드 {utilities.length}종({utilities.slice(0, 4).join(', ')} …)은 조합에 쓰이지
        않습니다. 같은 것을 여러 장 모아도 소용이 없고, <b>서로 다른 종류를 몇 가지 모았는지</b>로만
        점수가 매겨집니다.
      </p>

      <h3>조합과 점수</h3>
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
            <span className="combo-where">
              {definition.containers.length === containers.length
                ? '모든 컨테이너'
                : definition.containers
                    .map((container) => `${containerMeta[container]?.symbol ?? ''} ${container}`)
                    .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        한 컨테이너에서 <b>기본 단계는 가장 높은 것 하나만</b> 점수가 됩니다. Apply를 완성하면 그
        안에 이미 들어 있는 Functor는 따로 점수를 내지 않습니다. 특수 조합은 기본 단계와 별개로
        더해집니다.
      </p>

      <h3>Claim</h3>
      <p className="muted">
        조합을 새로 완성하면 자동으로 Claim됩니다. 같은 조합은 게임을 통틀어 한 사람만 가져갈 수
        있어서, 먼저 완성하는 쪽이 임자입니다.
      </p>
      <p className="muted">
        <b>Claim은 조합 점수와 따로 셉니다.</b> Apply를 만들면 Functor는 조합 점수를 더 내지
        않지만, Functor를 아직 아무도 Claim하지 않았다면 그 Claim은 그대로 가져갑니다. Foldable
        같은 특수 조합도 Monad를 Claim했든 아니든 따로 Claim할 수 있습니다.
      </p>
      <p className="muted">
        <b>한 장으로 여러 조합을 한꺼번에 완성하면 보너스가 붙습니다.</b> 동시에 선언한 것 중 첫
        번째는 1점, 두 번째는 2점, 세 번째는 3점이어서, 세 개를 몰아 완성하면 3점이 아니라
        6점입니다.
      </p>
      <p className="muted">
        그래서 순서가 곧 점수입니다. map을 놓고 ap을 놓으면 Functor와 Apply를 따로 가져가 2점이지만,
        ap을 먼저 두었다가 map을 나중에 놓으면 둘이 한꺼번에 완성되어 3점이 됩니다.
      </p>
    </details>
  );
}

/**
 * The operations each container actually has, read off the deck.
 *
 * From the deck rather than from the combo definitions: the deck is what a
 * player will draw from, and a container could hold a card no combo asks for.
 * Built once — the deck does not change while the page is open.
 */
const LADDER = ['map', 'ap', 'pure', 'chain'];
const CONTAINER_OPERATIONS: Record<string, string[]> = (() => {
  const deck = createDeck();
  const table: Record<string, string[]> = {};
  for (const container of containers) {
    const present = [...new Set(
      deck
        .filter((card) => card.kind === 'container-function' && card.container === container)
        .map((card) => card.operation),
    )];
    table[container] = [
      ...LADDER.filter((operation) => present.includes(operation)),
      ...present.filter((operation) => !LADDER.includes(operation)).sort(),
    ];
  }
  return table;
})();

const containerOperations = (container: string): string[] => CONTAINER_OPERATIONS[container] ?? [];
