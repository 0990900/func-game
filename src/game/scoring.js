import { curry, pipe } from 'fun-fp-js';
import { scoringCombos } from './combos.js';

const sumBy = curry((project, values) => values.reduce((sum, value) => sum + project(value), 0));

const utilityOperations = pipe(
  (cards) => cards.filter((card) => card.kind === 'utility'),
  (cards) => cards.map((card) => card.operation),
  (operations) => new Set(operations),
);

export function scoreUtilities(cards) {
  const operations = utilityOperations(cards);
  const n = operations.size;
  let diversity = 0;
  if (n === 2) diversity = 1;
  else if (n === 3) diversity = 4;
  else if (n === 4) diversity = 7;
  else if (n === 5) diversity = 11;
  else if (n === 6) diversity = 16;
  else if (n >= 7) diversity = 16 + (n - 6) * 4;

  return { diversity, total: diversity, count: n };
}

export function scorePlayer(player) {
  const combos = scoringCombos(player.playArea);
  const comboScore = sumBy((combo) => combo.score, combos);
  const utilities = scoreUtilities(player.playArea);
  const claimScore = player.claims.length;
  return {
    combos,
    comboScore,
    utilityScore: utilities.total,
    claimScore,
    total: comboScore + utilities.total + claimScore,
  };
}
