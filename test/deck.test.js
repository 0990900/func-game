import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/game/cards.js';

test('deck contains exactly one *.*',()=>{
  const deck=createDeck();
  assert.equal(deck.length,66);
  assert.equal(deck.filter(c=>c.label==='*.*').length,1);
});
