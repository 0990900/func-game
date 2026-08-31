/**
 * The secret goals, and how each one is judged.
 *
 * The test lives beside the text that promises it. Judging used to be a chain
 * of `if (goal.id === ...)` in the rules, which meant a goal could be written
 * here and score nothing at all — an unrecognised id fell off the end of the
 * chain and returned zero, silently, for the whole game.
 */
import { findCombos } from './combos.ts';
import { scoreUtilities } from './scoring.ts';
import { containers } from './cards.ts';
import type { Card, ContainerName, Goal } from './types.ts';

/** What a goal is given to judge itself against. */
export interface GoalCheck {
  readonly playArea: readonly Card[];
  /** Combos the play area satisfies, computed once for every goal. */
  readonly combos: ReturnType<typeof findCombos>;
  /**
   * Whether a real card of this container and operation is held.
   *
   * Real, not stood in for: a goal that says `조커 없이` has to mean it, and
   * `Maybe/Either/List/Task의 map을 모두 확보` is not satisfied by four jokers.
   */
  readonly holds: (container: ContainerName, operation: string) => boolean;
  /** Distinct operation names held, jokers excluded — `*` is not an operation. */
  readonly operations: ReadonlySet<string>;
}

/**
 * A goal, with the one thing it needs to judge itself: how far along you are.
 *
 * Everything is counted in steps. `met` is not written per goal — it is `done`
 * reaching `steps`, once, below — so the two can never drift apart. A bot that
 * only saw a yes/no would be blind until the final card and would never gather
 * toward a goal it could still reach.
 */
interface GoalSpec extends Goal {
  readonly steps: number;
  readonly done: (check: GoalCheck) => number;
}

export interface GoalDefinition extends GoalSpec {
  readonly met: (check: GoalCheck) => boolean;
}

/**
 * The definitions, judging function and all.
 *
 * Not what goes into a room: the core clones the room on every command with
 * `structuredClone`, which cannot copy a function, so a goal in a play area has
 * to be plain data. `goalCards` is the data half, and `judge` finds the
 * definition again by id.
 */
const specs: readonly GoalSpec[] = [
  {
    id: 'specialist',
    name: 'Specialist',
    text: '한 컨테이너에서 서로 다른 조합 6개 이상 완성',
    score: 7,
    steps: 6,
    done: ({ combos }) => {
      const perContainer = new Map<string, number>();
      for (const combo of combos) {
        perContainer.set(combo.container, (perContainer.get(combo.container) ?? 0) + 1);
      }
      return Math.min(6, Math.max(0, ...perContainer.values()));
    },
  },
  {
    id: 'generalist',
    name: 'Generalist',
    text: '네 컨테이너 모두에서 조합 완성',
    score: 6,
    steps: 4,
    done: ({ combos }) => new Set(combos.map((combo) => combo.container)).size,
  },
  {
    id: 'purist',
    name: 'Purist',
    text: '조커 없이 map과 ap를 같은 컨테이너에서 확보',
    score: 6,
    steps: 2,
    done: ({ holds }) => Math.max(...containers.map((container) =>
      (['map', 'ap'] as const).filter((operation) => holds(container, operation)).length)),
  },
  {
    id: 'utility-belt',
    name: 'Utility Belt',
    text: 'Utility 2종 이상 수집',
    score: 6,
    steps: 2,
    done: ({ playArea }) => Math.min(2, scoreUtilities(playArea).count),
  },
  {
    id: 'polyglot',
    name: 'Polyglot',
    text: '사다리 밖 조합을 4종류 이상 완성',
    score: 7,
    steps: 4,
    done: ({ combos }) => Math.min(4, new Set(
      combos.filter((combo) => combo.family === 'special').map((combo) => combo.name),
    ).size),
  },
  {
    id: 'collector',
    name: 'Collector',
    text: '서로 다른 연산 이름 9종 이상 확보',
    score: 7,
    steps: 9,
    done: ({ operations }) => Math.min(9, operations.size),
  },
];

/** Met is the same sentence for every goal: every step is done. */
const definitions: readonly GoalDefinition[] = specs.map((spec) => ({
  ...spec,
  met: (check) => spec.done(check) >= spec.steps,
}));

/** What a player is dealt and stores: no functions, so the room stays cloneable. */
export const goals: readonly Goal[] = definitions.map(
  ({ id, name, text, score }) => ({ id, name, text, score }),
);

/** The definition behind a dealt goal, or null if nothing can judge it. */
export const judge = (id: string): GoalDefinition | null =>
  definitions.find((definition) => definition.id === id) ?? null;

/** Builds the facts every goal is judged against, once per player. */
export function goalCheck(playArea: readonly Card[]): GoalCheck {
  return {
    playArea,
    combos: findCombos(playArea),
    holds: (container, operation) => playArea.some((card) =>
      card.kind === 'container-function'
      && card.container === container
      && card.operation === operation),
    // A joker's operation is `*`, which counted as a seventh kind of operation
    // and handed Collector to anyone holding one. A joker stands in for an
    // operation; it is not one.
    operations: new Set(
      playArea
        .filter((card) => card.operation && card.operation !== '*')
        .map((card) => card.operation),
    ),
  };
}
