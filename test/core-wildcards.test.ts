/**
 * A wildcard is spent once.
 *
 * Every combo used to be judged with its own fresh pool of wildcards, so a
 * single `*.*` counted as Maybe.chain and Either.map and List.traverse at the
 * same time — one card finishing structures in four containers at once. These
 * tests pin the rule that replaced it: the play area gets ONE assignment, each
 * wildcard fills one `Container:operation` slot, and that slot then behaves
 * exactly like the printed card would.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCoverage, findCombos, claimableCombos, scoringCombos } from '../src/core/combos.ts';
import { claimScore, scorePlayer } from '../src/core/scoring.ts';
import { createDeck, containers } from '../src/core/cards.ts';
import type { Card } from '../src/core/types.ts';

const deck = createDeck();
const pick = (match: (card: Card) => boolean, count = 1): Card[] => {
  const found = deck.filter(match).slice(0, count);
  assert.equal(found.length, count, 'fixture wanted cards the deck does not hold');
  return found;
};
const real = (container: string, operation: string): Card =>
  pick((c) => c.kind === 'container-function' && c.container === container && c.operation === operation)[0]!;
const wild = (operation: string): Card =>
  pick((c) => c.kind === 'operation-wildcard' && c.operation === operation)[0]!;
const joker = (): Card => pick((c) => c.kind === 'wildcard')[0]!;

const isWildcard = (card: Card): boolean =>
  card.kind === 'operation-wildcard' || card.kind === 'container-wildcard' || card.kind === 'wildcard';

/** Slots the printed cards supply on their own, with no wildcard standing in. */
const realSlots = (cards: readonly Card[]): Set<string> =>
  new Set(cards
    .filter((c) => c.kind === 'container-function')
    .map((c) => `${c.container}:${c.operation}`));

const comboTotal = (cards: readonly Card[]): number =>
  scoringCombos(cards).reduce((sum, combo) => sum + combo.score, 0);

/** A deterministic shuffle, so a failure can be reproduced from its seed. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const hands = function* (count: number, size = 15): Generator<Card[]> {
  const playable = deck.filter((c) => c.kind !== 'order-reverse');
  for (let seed = 1; seed <= count; seed += 1) yield shuffled(playable, seed).slice(0, size);
};

test('the bug in one hand: a joker no longer finishes four containers at once', () => {
  const cards = [
    real('Maybe', 'map'), real('Maybe', 'ap'), real('Maybe', 'pure'),
    real('List', 'map'), real('List', 'reduce'),
  ];
  const before = comboTotal(cards);
  const after = comboTotal([...cards, joker()]);

  // It used to be worth 19 points, completing Maybe Monad AND Either Functor AND
  // List Apply AND Task Functor AND List Traversable — five things from one card.
  assert.equal(before, 14);
  assert.equal(after, 24);

  const names = findCombos([...cards, joker()]).map((c) => `${c.container}:${c.name}`);
  assert.ok(names.includes('List:Traversable'), 'the joker should take the most valuable open slot');
  assert.ok(!names.includes('Maybe:Monad'), 'and therefore cannot also be Maybe.chain');
});

test('a wildcard fills one slot, never two', () => {
  for (const cards of hands(300)) {
    const covered = allocateCoverage(cards);
    const printed = realSlots(cards);
    const standIns = [...covered].filter((s) => !printed.has(s));
    const available = cards.filter(isWildcard).length;
    assert.ok(
      standIns.length <= available,
      `${standIns.length} slots covered by ${available} wildcards: ${standIns.join(', ')}`,
    );
  }
});

test('an assigned slot serves every rung that asks for it, as a real card would', () => {
  // `*.ap` becomes Maybe.ap, which Apply, Applicative and Monad all require.
  const cards = [real('Maybe', 'map'), real('Maybe', 'pure'), real('Maybe', 'chain'), wild('ap')];
  const built = findCombos(cards)
    .filter((c) => c.container === 'Maybe')
    .map((c) => c.name);
  for (const rung of ['Functor', 'Apply', 'Applicative', 'Monad']) {
    assert.ok(built.includes(rung), `Maybe ${rung} should be built`);
  }
});

test('a printed card never costs its owner points', () => {
  for (const cards of hands(200)) {
    let held: Card[] = [];
    let previous = 0;
    for (const card of cards) {
      held = [...held, card];
      const now = comboTotal(held);
      assert.ok(now >= previous, `adding ${card.label} dropped the score from ${previous} to ${now}`);
      previous = now;
    }
  }
});

test('a claim already earned is never taken back', () => {
  // Which combo a wildcard serves CAN move: a later card may make some other
  // arrangement worth more, and the allocator takes it. What must not move is a
  // claim already declared — it is recorded when earned and paid at the end,
  // whether or not the play area still shows the combo that produced it.
  for (const cards of hands(200)) {
    let held: Card[] = [];
    const earned: string[][] = [];
    const declared = new Set<string>();
    let total = 0;

    for (const card of cards) {
      const before = new Set(claimableCombos(held).map((c) => `${c.container}:${c.name}`));
      held = [...held, card];
      const fresh = claimableCombos(held)
        .map((c) => `${c.container}:${c.name}`)
        .filter((key) => !before.has(key) && !declared.has(key));
      if (fresh.length > 0) {
        earned.push(fresh);
        for (const key of fresh) declared.add(key);
      }

      const now = scorePlayer({ playArea: held, claimGroups: earned }).total;
      assert.ok(now >= total, `${card.label} dropped the total from ${total} to ${now}`);
      total = now;
    }

    assert.equal(
      scorePlayer({ playArea: held, claimGroups: earned }).claimScore,
      claimScore(earned),
      'every declared claim still pays at the end',
    );
  }
});

test('the same cards allocate the same way whatever order they arrive in', () => {
  for (const cards of hands(100)) {
    const expected = [...allocateCoverage(cards)].sort().join(',');
    for (const seed of [7, 21, 99]) {
      const actual = [...allocateCoverage(shuffled(cards, seed))].sort().join(',');
      assert.equal(actual, expected, 'allocation depends on card order');
    }
  }
});

test('a tie is broken the same way every time', () => {
  // Four operation wildcards spell a Monad and nothing else. Every container can
  // take it, so the printed order decides — and decides identically on every run.
  const cards = [wild('map'), wild('ap'), wild('pure'), wild('chain')];
  const first = findCombos(cards).map((c) => `${c.container}:${c.name}`).sort();
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(findCombos(shuffled(cards, i + 1)).map((c) => `${c.container}:${c.name}`).sort(), first);
  }
  assert.ok(first.includes(`${containers[0]}:Monad`), 'the first printed container wins the tie');
  assert.equal(first.filter((name) => name.endsWith(':Monad')).length, 1, 'only one Monad, not four');
});

test('the hand that scored 154 no longer does', () => {
  const cards = [
    wild('map'), wild('ap'), wild('pure'), joker(),
    real('Either', 'bimap'), real('List', 'traverse'), real('Maybe', 'alt'),
    real('Task', 'map'), real('Either', 'map'), real('Maybe', 'zero'), real('List', 'reduce'),
    ...pick((c) => c.kind === 'utility', 4),
  ];
  // Four wildcards used to stand up a Monad in all four containers at once: 69
  // combo points and a twelve-combo claim. Four wildcards can now fill four
  // slots, so both numbers have to come down.
  const standIns = [...allocateCoverage(cards)].filter((s) => !realSlots(cards).has(s));
  assert.ok(standIns.length <= 4, `four wildcards covered ${standIns.length} slots`);
  assert.ok(comboTotal(cards) < 69, `combo score is still ${comboTotal(cards)}`);
  assert.ok(claimableCombos(cards).length < 12, `${claimableCombos(cards).length} combos claimable at once`);
});
