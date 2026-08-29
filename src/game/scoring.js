import { scoringCombos } from './combos.js';

export function scoreUtilities(cards) {
  const operations = new Set(cards.filter((c) => c.kind === 'utility').map((c) => c.operation));
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
  const comboScore = combos.reduce((sum, combo) => sum + combo.score, 0);
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
