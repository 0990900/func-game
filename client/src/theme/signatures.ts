/**
 * What each card's operation actually is, as a type.
 *
 * The face of a card says what it is called and what it does in a sentence.
 * The back says the thing the sentence is an approximation of. `map` being
 * `(a → b) → F a → F b` is the whole reason Functor comes before Apply comes
 * before Monad, and a player who reads these four lines has learned the ladder
 * the game is built on.
 *
 * `F` is the container the card belongs to, substituted where the card names
 * one; a wildcard keeps `F`, since it stands for whichever it is used as.
 */
import type { Card } from '../../../src/core/types.ts';

/** Operation -> [signature with `F` as the container, one line on the law or intent]. */
export const operationSignature: Record<string, readonly [string, string]> = {
  map: ['(a → b) → F a → F b', '안의 값만 바꾸고 구조는 그대로 둡니다.'],
  ap: ['F (a → b) → F a → F b', '함수도 구조 안에 있을 때 적용합니다.'],
  pure: ['a → F a', '보통 값을 구조 안으로 올립니다.'],
  chain: ['(a → F b) → F a → F b', '구조를 만드는 함수를 이어 붙이고 한 겹으로 눌러줍니다.'],
  alt: ['F a → F a → F a', '앞이 비면 뒤를 씁니다.'],
  zero: ['F a', '아무것도 없는 값. alt의 항등원입니다.'],
  bimap: ['(a → b) → (c → d) → F a c → F b d', '두 자리를 각각 다른 함수로 바꿉니다.'],
  reduce: ['(b → a → b) → b → F a → b', '초깃값에서 시작해 하나로 접습니다.'],
  traverse: ['(a → G b) → F a → G (F b)', '효과를 안팎으로 뒤집습니다.'],
};

/** Utility cards are plain functions; they have no container to substitute. */
export const utilitySignature: Record<string, readonly [string, string]> = {
  curry: ['((a, b) → c) → a → b → c', '인자를 하나씩 받도록 풀어냅니다.'],
  uncurry: ['(a → b → c) → (a, b) → c', 'curry의 반대입니다.'],
  flip: ['(a → b → c) → b → a → c', '앞의 두 인자 순서를 바꿉니다.'],
  compose: ['(b → c) → (a → b) → a → c', '오른쪽부터 왼쪽으로 이어 붙입니다.'],
  pipe: ['(a → b) → (b → c) → a → c', 'compose를 읽는 순서대로 뒤집은 것입니다.'],
  identity: ['a → a', '받은 것을 그대로 돌려줍니다.'],
  constant: ['a → b → a', '두 번째 인자를 버립니다.'],
  partial: ['((a, b) → c) → a → (b → c)', '인자 일부를 미리 채웁니다.'],
  tap: ['(a → void) → a → a', '값은 그대로 흘려보내고 곁다리 효과만 냅니다.'],
  apply: ['(a → b) → a → b', '함수를 값에 적용합니다.'],
  thunk: ['a → (() → a)', '계산을 나중으로 미룹니다.'],
  memoize: ['(a → b) → (a → b)', '같은 입력의 결과를 기억해 다시 계산하지 않습니다.'],
};

/**
 * How a container's name appears in a signature.
 *
 * Either takes two type arguments, so anything treating it as `F a` has to
 * write `Either e a` — `a -> Either a` is simply not the type of `Either.pure`,
 * and a teaching card that prints the wrong type teaches the wrong thing.
 * `bimap` is the exception: it applies both arguments itself, so it wants the
 * bare name.
 */
const applied: Record<string, string> = { Maybe: 'Maybe', Either: 'Either e', List: 'List', Task: 'Task' };

/** Operations whose shape already applies every argument the container takes. */
const bareContainer = new Set(['bimap']);

export interface CardBack {
  readonly signature: string;
  readonly note: string;
}

export function cardBack(card: Card): CardBack {
  if (card.kind === 'utility') {
    const [signature, note] = utilitySignature[card.operation] ?? ['a → a', '보조 함수입니다.'];
    return { signature, note };
  }

  if (card.operation === '*') {
    // A container wildcard stands in for one operation of that container, and
    // the universal one for any card at all; neither has a signature of its own.
    return card.container === '*'
      ? { signature: '아무 카드로나', note: '어떤 컨테이너의 어떤 연산으로도 씁니다. 단, 조커만으로는 Claim할 수 없습니다.' }
      : { signature: `${card.container}의 아무 연산으로나`, note: `${card.container} 안에서 부족한 자리를 채웁니다. 조커만으로는 Claim할 수 없습니다.` };
  }

  const entry = operationSignature[card.operation];
  if (!entry) return { signature: card.operation, note: '' };

  const [shape, note] = entry;
  // `*.map` keeps `F`: it has an operation but not a container to put in it.
  const name = card.container && card.container !== '*' ? card.container : null;
  if (!name) return { signature: shape, note };
  const substitute = bareContainer.has(card.operation) ? name : applied[name] ?? name;
  return { signature: shape.replaceAll('F', substitute), note };
}
