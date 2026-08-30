/**
 * Number keys for the top row.
 *
 * `1` is the drawn card and `2`–`5` are the market, left to right — the order
 * they are already in on screen, so there is nothing to memorise beyond
 * counting. Pressing a key twice commits: `1 1` plays the drawn card, `1 3 3`
 * trades it for the second market card. Escape puts everything back.
 *
 * Committing on a second press of the *same* key rather than on Enter keeps the
 * whole interaction on one hand and makes the confirm impossible to fire by
 * accident: the key that commits is the key that named the thing.
 *
 * The keyboard skips the two-step reveal the taps use. A fanned card is mostly
 * covered, so a first tap has to mean "let me look" — but a key names its card
 * outright, and there is nothing to look at first.
 */
import { actions, gameStore } from '../store/gameStore.ts';

/** Index 0 is the drawn card; 1-4 are the market, in the order drawn on screen. */
const KEYS = ['1', '2', '3', '4', '5'] as const;

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement
  && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

export function bindKeys(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // A modifier means the key belongs to the browser or the OS, not to us.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    const { state, selectedCardId, selectedMarketId } = gameStore.getState();
    if (!state || state.phase !== 'draft' || !state.me?.isMyTurn) return;

    if (event.key === 'Escape') {
      // An open sheet owns Escape; closing it is the more immediate undo.
      if (document.querySelector('.sheet')) return;
      if (!selectedCardId && !selectedMarketId) return;
      event.preventDefault();
      actions.clearPick();
      return;
    }

    const index = KEYS.indexOf(event.key as typeof KEYS[number]);
    if (index < 0 || !state.drawn) return;
    event.preventDefault();

    if (index === 0) {
      // Twice on the drawn card plays it. With a market card in hand, `1` backs
      // out of the trade rather than committing something else than was shown.
      if (selectedCardId && !selectedMarketId) {
        actions.submitPick();
        return;
      }
      actions.setPick(state.drawn.id, null);
      return;
    }

    const market = state.market[index - 1];
    if (!market) return;
    // Twice on the same market card trades for it; a different one moves the
    // intent across without committing anything.
    if (selectedMarketId === market.id) actions.submitPick();
    else actions.setPick(state.drawn.id, market.id);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
