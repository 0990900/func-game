import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreUtilities } from '../src/game/scoring.js';

const utilityCards = (operations) => operations.map((operation) => ({ kind: 'utility', operation }));

test('utility scoring uses diversity only', () => {
  assert.deepEqual(scoreUtilities(utilityCards(['curry', 'uncurry'])), {
    diversity: 1,
    total: 1,
    count: 2,
  });
  assert.equal(scoreUtilities(utilityCards(['curry', 'uncurry', 'flip'])).total, 4);
  assert.equal(scoreUtilities(utilityCards(['curry', 'uncurry', 'flip', 'compose', 'pipe', 'identity', 'tap'])).total, 20);
});
