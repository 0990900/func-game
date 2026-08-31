import type { Card, ContainerName } from './types.ts';

type Spec = readonly [ContainerName, string, number];

const specs: readonly Spec[] = [
  ['Maybe', 'map', 2], ['Maybe', 'ap', 2], ['Maybe', 'pure', 2], ['Maybe', 'chain', 2], ['Maybe', 'alt', 2], ['Maybe', 'zero', 1],
  ['Either', 'map', 2], ['Either', 'ap', 2], ['Either', 'pure', 2], ['Either', 'chain', 2], ['Either', 'alt', 1], ['Either', 'bimap', 2],
  ['List', 'map', 2], ['List', 'ap', 2], ['List', 'pure', 2], ['List', 'chain', 2], ['List', 'reduce', 2], ['List', 'traverse', 2],
  ['Task', 'map', 2], ['Task', 'ap', 2], ['Task', 'pure', 2], ['Task', 'chain', 2],
];

export const utilities: readonly string[] = [
  'curry', 'uncurry', 'flip', 'compose', 'pipe', 'identity',
  'constant', 'partial', 'tap', 'apply', 'thunk', 'memoize',
];

export const containers: readonly ContainerName[] = ['Maybe', 'Either', 'List', 'Task'];

export function createDeck(): Card[] {
  let seq = 0;
  const cards: Card[] = [];
  const add = (base: Omit<Card, 'id'>, count = 1): void => {
    for (let i = 0; i < count; i += 1) cards.push({ ...base, id: `card-${++seq}` });
  };

  for (const [container, operation, count] of specs) {
    add({ kind: 'container-function', container, operation, label: `${container}.${operation}` }, count);
  }

  add({ kind: 'operation-wildcard', container: '*', operation: 'map', label: '*.map' }, 2);
  for (const op of ['ap', 'pure', 'chain', 'alt', 'traverse']) {
    add({ kind: 'operation-wildcard', container: '*', operation: op, label: `*.${op}` });
  }

  for (const container of containers) {
    add({ kind: 'container-wildcard', container, operation: '*', label: `${container}.*` });
  }

  add({ kind: 'wildcard', container: '*', operation: '*', label: '*.*' });
  for (const operation of utilities) {
    add({ kind: 'utility', container: null, operation, label: operation });
  }

  // One card that is never played: whoever draws it sets it aside and the order
  // of play turns around. Everything that handles it — the draw, the flip, the
  // event, the sound — was written and tested against a card injected by hand,
  // and nobody noticed the deck had never contained one.
  add({ kind: 'order-reverse', container: null, operation: 'reverse', label: '순서 바꾸기' });

  return cards;
}
