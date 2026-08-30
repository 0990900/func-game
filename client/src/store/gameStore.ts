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
import { sound } from '../ui/sound.ts';
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
  /**
   * Cards in the top row show their type instead of their face. A study mode,
   * not a game state: it survives turns and is nobody's business but this
   * player's, so it never reaches the server.
   */
  showSignatures: boolean;
  /**
   * Whether the other players' boards are drawn. Off by default: four boards
   * are taller than any window, and the one that got cut off the bottom was
   * always the last seat — with nothing on screen to say it was there.
   */
  showOpponents: boolean;
  /**
   * Server clock minus this device's, from the last state received. Turn
   * deadlines are stamped on the server, so a device whose clock is off would
   * otherwise run the countdown out early or never.
   *
   * It absorbs the one-way trip as well as the skew, since `serverNow` is a
   * send time measured against a receive time. The countdown therefore runs a
   * latency late — tens of milliseconds against a thirty-second turn. Fixing it
   * would mean measuring round trips, which is a protocol for an error smaller
   * than the tick.
   */
  clockOffset: number;
}

const initial: GameState = {
  connection: 'idle',
  connectionError: null,
  roomCode: null,
  state: null,
  selectedCardId: null,
  selectedMarketId: null,
  previewCardId: null,
  previewMarketId: null,
  toasts: [],
  myTurnAnnounced: false,
  showSignatures: false,
  showOpponents: false,
  clockOffset: 0,
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

/**
 * Title, toast and a cue when the turn becomes ours.
 *
 * Two sounds, in the order the things happen: the card comes off the deck, and
 * then the game says it is your move. `turn` carries its own delay so the
 * announcement lands after the card does rather than on top of it.
 */
function announceMyTurn(): void {
  document.title = '내 턴! · FP Draft';
  pushToast('내 턴입니다. 뽑은 카드를 선택하세요.');
  sound.play('draw');
  sound.play('turn');
}

/**
 * The sounds this state change earns, if any.
 *
 * Only what this player did or is being asked to do. A cue for every seat's
 * every turn is sixty sounds a game from three people you are not, which is a
 * mute button being pressed rather than a game feeling alive.
 */
function announce(previous: PublicState | null, next: PublicState): void {
  const meId = next.me?.id;
  if (!meId) return;

  // A card off the deck is a sound in its own right. It comes with the turn on
  // the first draw, and on its own when a reverse card is set aside and another
  // is dealt in its place — a moment that otherwise passed in silence.
  const drew = next.drawn && next.drawn.id !== previous?.drawn?.id;
  if (drew && next.me?.isMyTurn && previous?.me?.isMyTurn) sound.play('draw');

  if (next.phase === 'finished' && previous?.phase !== 'finished') {
    sound.play('finish');
    return;
  }

  // The event log is authoritative about what just happened, and its newest
  // entry is the one this broadcast carries.
  const latest = next.events[0];
  if (!latest || latest.playerId !== meId) return;
  if (latest.id === previous?.events[0]?.id) return;

  if (latest.type === 'claim') {
    // How many were declared together, read off the state rather than out of
    // the sentence describing it: the message is for people, and a regex over
    // it would break the day the wording changed.
    const groups = next.players.find((player) => player.id === meId)?.claimGroups ?? [];
    sound.play('claim', groups[groups.length - 1]?.length ?? 1);
    return;
  }
  if (latest.type === 'market') sound.play('swap');
  else if (latest.type === 'pick') sound.play('place');
}

const handlers: Handlers = {
  onState: (next, serverNow) => {
    const previous = get().state;
    const becameMyTurn = Boolean(next.me?.isMyTurn) && !previous?.me?.isMyTurn;
    announce(previous, next);
    if (becameMyTurn) announceMyTurn();
    else if (!next.me?.isMyTurn) document.title = 'FP Draft Game';

    set({
      state: next,
      clockOffset: serverNow - Date.now(),
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
  toggleSignatures: () => set((current) => ({ showSignatures: !current.showSignatures })),
  toggleOpponents: () => set((current) => ({ showOpponents: !current.showOpponents })),

  host: (name: string) => connect(() => createRoom(name, handlers)),
  join: (roomId: string, name: string) => connect(() => joinRoom(roomId.trim(), name, handlers)),
  /** Joins to watch: no seat, no actions, no score. */
  observe: (roomId: string) => connect(() => joinRoom(roomId.trim(), '관전자', handlers, true)),

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
  restartGame: () => send('restart_game'),
  kickPlayer: (playerId: string) => send('kick_player', { playerId }),
  chooseGoal: (goalId: string) => send('choose_goal', { goalId }),

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

  /**
   * Sets both halves of a pick outright.
   *
   * The tap actions walk a two-step reveal because a fanned card is mostly
   * covered and a first tap has to mean "let me look". A keypress has no such
   * problem — the key names the card — so it says what it means directly.
   */
  setPick: (cardId: string, marketCardId: string | null) => set({
    selectedCardId: cardId, selectedMarketId: marketCardId,
    previewCardId: null, previewMarketId: null,
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
