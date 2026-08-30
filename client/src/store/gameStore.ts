/**
 * One store, two consumers: React subscribes with a hook, and the Pixi table
 * (milestone D) subscribes imperatively. Neither owns the state.
 *
 * Card selection is local — the server never sees a half-made pick — and is
 * cleared on every state message, matching the legacy client: an authoritative
 * update always supersedes what the player was in the middle of choosing.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { PublicState } from '../../../src/core/types.ts';
import { createRoom, joinRoom, resumeRoom } from '../net/connection.ts';
import { isNarrow } from '../ui/viewport.ts';
import type { GameRoom, Handlers } from '../net/connection.ts';

export type ConnectionPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const RESUME_KEY = 'fp-draft:resume';

export interface Toast {
  readonly id: number;
  readonly text: string;
}

export interface GameState {
  connection: ConnectionPhase;
  connectionError: string | null;
  roomCode: string | null;
  state: PublicState | null;
  /** The previous reveal, kept so the table can animate what just moved. */
  previousReveal: PublicState['lastReveal'];
  selectedCardId: string | null;
  selectedMarketId: string | null;
  /**
   * The hand card raised for a look but not yet chosen. Only used on narrow
   * screens, where the hand is fanned and most of each card is covered: the
   * first tap reveals, the second commits.
   */
  previewCardId: string | null;
  /** The market card raised for a look. Same two-tap rule as the hand. */
  previewMarketId: string | null;
  toasts: Toast[];
  myTurnAnnounced: boolean;
}

const initial: GameState = {
  connection: 'idle',
  connectionError: null,
  roomCode: null,
  state: null,
  previousReveal: [],
  selectedCardId: null,
  selectedMarketId: null,
  previewCardId: null,
  previewMarketId: null,
  toasts: [],
  myTurnAnnounced: false,
};

export const gameStore = createStore<GameState>(() => initial);

const set = gameStore.setState;
const get = gameStore.getState;

let room: GameRoom | null = null;
let toastSeq = 0;

export function pushToast(text: string): void {
  const toast = { id: (toastSeq += 1), text };
  set((s) => ({ toasts: [...s.toasts, toast] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), 2500);
}

/** Title, toast and a short beep when the turn becomes ours — ported from the legacy client. */
function announceMyTurn(): void {
  document.title = '내 턴! · FP Draft';
  pushToast('내 턴입니다. 손패에서 한 장을 선택하세요.');
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.04, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.18);
  } catch {
    // Audio is a nicety; a blocked AudioContext must not break the turn.
  }
}

const handlers: Handlers = {
  onState: (next) => {
    const previous = get().state;
    const becameMyTurn = Boolean(next.me?.isMyTurn) && !previous?.me?.isMyTurn;
    if (becameMyTurn) announceMyTurn();
    else if (!next.me?.isMyTurn) document.title = 'FP Draft Game';

    set({
      state: next,
      previousReveal: previous?.lastReveal ?? [],
      selectedCardId: null,
      selectedMarketId: null,
      previewCardId: null,
      previewMarketId: null,
      connection: 'connected',
      myTurnAnnounced: becameMyTurn,
    });
  },
  onError: (message) => pushToast(message),
  onLeave: (code) => {
    // 1000 is a clean close; anything else means we dropped and may return.
    if (code === 1000) {
      clearResume();
      set({ connection: 'idle', roomCode: null, state: null });
    } else {
      set({ connection: 'reconnecting' });
    }
  },
};

function remember(joined: GameRoom): void {
  room = joined;
  set({ connection: 'connected', connectionError: null, roomCode: joined.roomId });
  try {
    sessionStorage.setItem(RESUME_KEY, joined.reconnectionToken);
  } catch {
    // Private browsing: resuming after a refresh is simply unavailable.
  }
}

function clearResume(): void {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to clear.
  }
}

async function connect(open: () => Promise<GameRoom>): Promise<void> {
  set({ connection: 'connecting', connectionError: null });
  try {
    remember(await open());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    set({ connection: 'error', connectionError: message });
    pushToast(message);
  }
}

const send = (type: string, payload?: unknown): void => room?.send(type, payload);

export const actions = {
  host: (name: string) => connect(() => createRoom(name, handlers)),
  join: (roomId: string, name: string) => connect(() => joinRoom(roomId.trim(), name, handlers)),

  /** Attempts to retake a seat after a refresh. Silent when there is nothing to resume. */
  resume: async (): Promise<boolean> => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(RESUME_KEY);
    } catch {
      return false;
    }
    if (!token) return false;

    set({ connection: 'reconnecting' });
    try {
      remember(await resumeRoom(token, handlers));
      return true;
    } catch {
      clearResume();
      set({ connection: 'idle' });
      return false;
    }
  },

  startGame: () => send('start_game'),
  chooseGoal: (goalId: string) => send('choose_goal', { goalId }),
  claim: (container: string, name: string) => send('claim', { container, name }),
  finishClaim: () => send('finish_claim'),

  selectCard: (cardId: string) =>
    set((s) => {
      // Tapping the chosen card again puts it back.
      if (s.selectedCardId === cardId) {
        return {
          selectedCardId: null, selectedMarketId: null,
          previewCardId: null, previewMarketId: null,
        };
      }
      // Wide screens show every card in full, so one tap is enough.
      if (!isNarrow()) return { selectedCardId: cardId, previewCardId: null };
      // Narrow: reveal first, commit on the second tap of the same card.
      return s.previewCardId === cardId
        ? { selectedCardId: cardId, previewCardId: null }
        : {
            previewCardId: cardId, selectedCardId: null,
            selectedMarketId: null, previewMarketId: null,
          };
    }),

  selectMarket: (cardId: string) =>
    set((s) => {
      if (s.selectedMarketId === cardId) return { selectedMarketId: null, previewMarketId: null };
      if (!isNarrow()) return { selectedMarketId: cardId, previewMarketId: null };
      // Narrow: the market is fanned too, so reveal first and commit on the
      // second tap — the same rule as the hand, so there is one thing to learn.
      return s.previewMarketId === cardId
        ? { selectedMarketId: cardId, previewMarketId: null }
        : { previewMarketId: cardId, selectedMarketId: null };
    }),

  clearPick: () => set({
    selectedCardId: null, selectedMarketId: null,
    previewCardId: null, previewMarketId: null,
  }),

  submitPick: () => {
    const { selectedCardId, selectedMarketId } = get();
    if (!selectedCardId) return;
    send('pick', { cardId: selectedCardId, marketCardId: selectedMarketId });
  },

  leave: async () => {
    clearResume();
    await room?.leave(true);
    room = null;
    set({ ...initial });
  },
} as const;

export function useGame<T>(select: (state: GameState) => T): T {
  return useStore(gameStore, select);
}
