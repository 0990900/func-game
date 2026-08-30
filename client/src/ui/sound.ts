/**
 * The game's sounds, named rather than described.
 *
 * Callers ask for `sound.play('claim', 3)` and never touch an oscillator or a
 * buffer. What a cue is made of lives here alone, so swapping synthesis for
 * recorded samples later changes this file and nothing else.
 *
 * One AudioContext for the page. The previous beep built a new one per turn,
 * and browsers cap the number a document may create — around six — after which
 * construction throws and the sound silently stopped for the rest of the game.
 *
 * It is created on the first gesture, because autoplay policy suspends a
 * context created without one, and a suspended context plays nothing while
 * reporting success.
 */

export type Cue =
  /** The turn became ours. The one sound worth hearing from another tab. */
  | 'turn'
  /** A card went to the play area. */
  | 'place'
  /** A card was traded for one in the market. */
  | 'swap'
  /** A combo was declared. The count says how many at once. */
  | 'claim'
  /** The turn clock is nearly out. */
  | 'hurry'
  /** The game is over. */
  | 'finish';

const STORAGE_KEY = 'fp-draft:muted';

/** A5. Everything else is placed against this so the cues stay in one key. */
const ROOT = 880;
/** Semitone ratio, for building intervals without a table of frequencies. */
const semitone = (steps: number): number => ROOT * 2 ** (steps / 12);

interface Note {
  readonly hz: number;
  /** Seconds from the start of the cue. */
  readonly at: number;
  readonly seconds: number;
  readonly gain: number;
  readonly type: OscillatorType;
}

let context: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private windows and blocked storage: default to audible.
    return false;
  }
}

/**
 * The shared context, but only once it can actually make a sound.
 *
 * A context built outside a user gesture starts suspended, and `resume()` is
 * only honoured from inside one. Creating it lazily on the first cue meant
 * whichever cue came first decided: one fired from a click worked, one fired
 * from the turn clock or an incoming message did not. That is what "sometimes
 * it plays" was.
 *
 * So nothing is built until a gesture arrives, and until then `play` is a
 * no-op rather than scheduling notes into a context whose clock is not running.
 */
function audio(): AudioContext | null {
  if (muted || !context) return null;
  // Safari parks the context on 'interrupted' after a call or a background
  // switch, and it will not start again on its own.
  if (context.state !== 'running') {
    void context.resume();
    return null;
  }
  return context;
}

/**
 * Starts the audio system from inside a user gesture.
 *
 * Playing an empty buffer here is the part that matters on iOS: the context
 * only truly starts once something has been played from within the gesture,
 * and resuming alone leaves it silent while reporting `running`.
 */
function unlock(): void {
  if (muted || context) return;
  try {
    context = new AudioContext();
    void context.resume();
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(1, 1, context.sampleRate);
    silence.connect(context.destination);
    silence.start();
  } catch {
    context = null;
  }
}

/**
 * Listens for the first gesture of the session, and for the app coming back to
 * the foreground — which suspends the context on mobile without telling anyone.
 */
export function bindSound(): () => void {
  const onGesture = (): void => unlock();
  const onVisible = (): void => {
    if (document.visibilityState === 'visible' && context?.state !== 'running') {
      void context?.resume();
    }
  };

  window.addEventListener('pointerdown', onGesture);
  window.addEventListener('keydown', onGesture);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function tone(ctx: AudioContext, note: Note): void {
  const start = ctx.currentTime + note.at;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = note.type;
  oscillator.frequency.setValueAtTime(note.hz, start);
  // A hard start clicks. Ramp up over a few milliseconds, then decay: that
  // envelope is what makes a square wave read as a card sound rather than a
  // buzzer.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + note.seconds);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + note.seconds + 0.02);
}

/**
 * A rising run, one note per combo declared together.
 *
 * The bonus is that the nth combo declared at once pays n, and this is that
 * rule as a sound: one claim is a single note, three is a three-note climb.
 * Nobody has to be told what the arpeggio means to notice it got longer.
 */
function claimRun(count: number): Note[] {
  const steps = Math.max(1, Math.min(count, 4));
  // A major triad continued into the octave: 0, 4, 7, 12 semitones.
  const intervals = [0, 4, 7, 12];
  return Array.from({ length: steps }, (_, index) => ({
    hz: semitone(intervals[index]!),
    at: index * 0.07,
    seconds: 0.16,
    gain: 0.05,
    type: 'triangle' as const,
  }));
}

function notesFor(cue: Cue, count: number): Note[] {
  switch (cue) {
    case 'turn':
      // Two notes rising a fifth: an announcement, not an alarm.
      return [
        { hz: semitone(-5), at: 0, seconds: 0.12, gain: 0.05, type: 'triangle' },
        { hz: semitone(2), at: 0.09, seconds: 0.16, gain: 0.05, type: 'triangle' },
      ];
    case 'place':
      // Short, low and dry: a card meeting the table, not a chime.
      return [{ hz: semitone(-24), at: 0, seconds: 0.07, gain: 0.07, type: 'square' }];
    case 'swap':
      // Two clicks, because a swap is two cards moving.
      return [
        { hz: semitone(-24), at: 0, seconds: 0.06, gain: 0.06, type: 'square' },
        { hz: semitone(-19), at: 0.075, seconds: 0.07, gain: 0.06, type: 'square' },
      ];
    case 'claim':
      return claimRun(count);
    case 'hurry':
      // One dull tick a second. Deliberately unmusical: it should nag.
      return [{ hz: semitone(-12), at: 0, seconds: 0.05, gain: 0.045, type: 'square' }];
    case 'finish':
      // A descending close — the game relaxing rather than another reward.
      return [
        { hz: semitone(12), at: 0, seconds: 0.18, gain: 0.05, type: 'triangle' },
        { hz: semitone(7), at: 0.13, seconds: 0.18, gain: 0.05, type: 'triangle' },
        { hz: semitone(0), at: 0.26, seconds: 0.34, gain: 0.05, type: 'triangle' },
      ];
  }
}

export const sound = {
  /** `count` only means anything to `claim`, where it is the group size. */
  play(cue: Cue, count = 1): void {
    const ctx = audio();
    if (!ctx) return;
    try {
      for (const note of notesFor(cue, count)) tone(ctx, note);
    } catch {
      // A context can be closed out from under us by the browser.
    }
  },

  isMuted: (): boolean => muted,

  setMuted(next: boolean): void {
    muted = next;
    // Turning it back on has to rebuild: this runs from a click, which is the
    // gesture the context needs anyway.
    if (!next && !context) unlock();
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // The preference is a convenience; failing to store it is not an error.
    }
    if (next && context) {
      // Silence anything already scheduled, rather than letting the tail play.
      void context.close();
      context = null;
    }
  },
};
