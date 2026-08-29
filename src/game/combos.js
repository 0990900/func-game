import { containers } from './cards.js';

export const comboDefinitions = [
  { name: 'Functor', family: 'base', score: 2, containers, requires: ['map'] },
  { name: 'Apply', family: 'base', score: 4, containers, requires: ['map', 'ap'] },
  { name: 'Applicative', family: 'base', score: 6, containers, requires: ['map', 'ap', 'pure'] },
  { name: 'Monad', family: 'base', score: 9, containers, requires: ['map', 'ap', 'pure', 'chain'] },
  { name: 'Alternative', family: 'special', score: 11, containers: ['Maybe'], requires: ['map', 'ap', 'pure', 'alt', 'zero'] },
  { name: 'Bifunctor', family: 'special', score: 6, containers: ['Either'], requires: ['map', 'bimap'] },
  { name: 'Foldable', family: 'special', score: 6, containers: ['List'], requires: ['map', 'reduce'] },
  { name: 'Traversable', family: 'special', score: 10, containers: ['List'], requires: ['map', 'reduce', 'traverse'] },
];

function resources(cards, container) {
  const exact = new Set();
  const operationWildcards = [];
  let containerWildcards = 0;
  let universalWildcards = 0;

  for (const card of cards) {
    if (card.kind === 'container-function' && card.container === container) exact.add(card.operation);
    else if (card.kind === 'operation-wildcard') operationWildcards.push(card.operation);
    else if (card.kind === 'container-wildcard' && card.container === container) containerWildcards += 1;
    else if (card.kind === 'wildcard') universalWildcards += 1;
  }
  return { exact, operationWildcards, containerWildcards, universalWildcards };
}

export function canBuild(cards, container, requires) {
  const r = resources(cards, container);
  const opWilds = [...r.operationWildcards];
  let freeWilds = r.containerWildcards + r.universalWildcards;

  for (const op of requires) {
    if (r.exact.has(op)) continue;
    const opIndex = opWilds.indexOf(op);
    if (opIndex >= 0) {
      opWilds.splice(opIndex, 1);
      continue;
    }
    if (freeWilds > 0) {
      freeWilds -= 1;
      continue;
    }
    return false;
  }
  return true;
}

export function findCombos(cards) {
  const found = [];
  for (const def of comboDefinitions) {
    for (const container of def.containers) {
      if (canBuild(cards, container, def.requires)) found.push({ ...def, container });
    }
  }
  return found;
}

export function scoringCombos(cards) {
  const found = findCombos(cards);
  const scored = [];

  for (const container of containers) {
    const base = found
      .filter((c) => c.container === container && c.family === 'base')
      .sort((a, b) => b.score - a.score)[0];
    if (base) scored.push(base);
  }

  scored.push(...found.filter((c) => c.family === 'special'));
  return scored;
}
