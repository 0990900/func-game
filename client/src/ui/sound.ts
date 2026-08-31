/**
 * The game's sounds, named rather than described.
 *
 * Callers ask for `sound.play('claim', 3)` and never touch an oscillator or a
 * buffer. What a cue is made of lives here alone, which is what let the card
 * sounds become recordings without a single caller changing.
 *
 * Cards are samples and states are synthesised, because they are different
 * kinds of sound. A card meeting the table is friction — broadband noise with
 * no pitch, and nothing an oscillator produces is mistakable for it. A turn
 * starting or a clock running out is a message, and a message wants a pitch you
 * can tell apart from the last one.
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
  /** A card came off the deck for us. */
  | 'draw'
  /** The turn became ours. The one sound worth hearing from another tab. */
  | 'turn'
  /** A card was picked up to look at, before anything is committed. */
  | 'select'
  /** A card went to the play area. */
  | 'place'
  /** Someone else's card went to their play area. */
  | 'opponent'
  /** A card was traded for one in the market. */
  | 'swap'
  /** A combo was declared. The count says how many at once. */
  | 'claim'
  /** The turn clock is nearly out. */
  | 'hurry'
  /** A reverse card flipped the order of play. */
  | 'reverse'
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

/**
 * Recordings, by cue. Kenney's Casino Audio pack (CC0) — the card sounds most
 * card games are built from, transcoded from Ogg to AAC. Safari does not decode
 * Ogg Vorbis, which would have left it with tones and nothing else.
 *
 * Several files per cue so the same card does not land identically fifteen
 * times a game; one is picked at random each time.
 */
const SAMPLES: Partial<Record<Cue, readonly string[]>> = {
  // Off the deck, onto the table, and away into the market: three different
  // things happening to a card, so three different recordings of one.
  draw: ['card-slide-1', 'card-slide-2', 'card-slide-3'],
  select: ['card-slide-5'],
  place: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  // The same recordings: a card landing is a card landing, whoever laid it.
  opponent: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  swap: ['card-shove-1', 'card-shove-2'],
  reverse: ['dg_powerUp10'],
};

/**
 * Whether a recording needs trimming at all.
 *
 * The card files are foley: a microphone in a room, with the room audible
 * before and after the card. The interface and digital packs are designed cues
 * — they start when they start and end when they mean to, and cutting one at a
 * quarter-second turns a rising run into its first note.
 */
const isFoley = (name: string): boolean => !/^(dg|if|ui)_/.test(name);

/**
 * The soonest another player's card may be heard after the last one.
 *
 * Bots act 450-850ms apart, and three of them in succession would otherwise
 * stack into a rattle. This is a floor on the gap, not a volume: the sound is
 * the one the player asked for, only never twice at once.
 */
const OPPONENT_GAP_MS = 220;
let lastOpponent = 0;

const SAMPLE_GAIN = 0.55;

/**
 * How much of a recording is actually the card.
 *
 * Kenney's files run 450-770ms, but the card itself is over in a fraction of
 * that: the transient starts 120-200ms in and what follows is the room. Played
 * whole, the lead-in delayed every sound and the tail read as hiss — `shove`
 * worst of all, its noise floor ten times the others'. Only the transient is
 * played, so the recordings are kept exactly as they came.
 */
const CLIP_SECONDS = 0.26;
/** Silences the cut end, so trimming is not itself a click. */
const CLIP_FADE = 0.05;
/** Where the card starts, as a share of the file's own peak. */
const ONSET = 0.08;

/**
 * How much louder the synthesised cues have to be to sit with the recordings.
 *
 * Kenney's files peak around 0.77, so after `SAMPLE_GAIN` they reach about
 * 0.42 while a tone was asking for 0.05 — eight times quieter, which is not a
 * balance but an inaudible layer. Every note gain below is written at its
 * relative weight and scaled here, so the two stay in proportion if either
 * moves.
 */
const TONE_GAIN = 7;

let context: AudioContext | null = null;
let muted = readMuted();
/** A decoded recording and the window of it worth playing. */
interface Clip {
  readonly buffer: AudioBuffer;
  /** Seconds into the file where the card begins. */
  readonly offset: number;
  /** Seconds of it to play. */
  readonly seconds: number;
}

/** Decoded and measured once: decoding is the expensive part, playing is not. */
const clips = new Map<string, Clip>();

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
    void preload(context);
  } catch {
    context = null;
  }
}

/**
 * Fetches and decodes every sample once.
 *
 * Failure is silent and per-file: a cue whose recording did not arrive falls
 * back to its synthesised form, which is worse but is not nothing.
 */
async function preload(ctx: AudioContext): Promise<void> {
  const names = Object.values(SAMPLES).flat();
  await Promise.all(names.map(async (name) => {
    if (clips.has(name)) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sounds/${name}.m4a`);
      if (!response.ok) return;
      clips.set(name, trim(name, await ctx.decodeAudioData(await response.arrayBuffer())));
    } catch {
      // The synthesised fallback covers a file that will not decode, rather
      // than the cue going missing.
    }
  }));
}

/** Finds where the card starts and how much of the file to keep. */
function trim(name: string, buffer: AudioBuffer): Clip {
  if (!isFoley(name)) return { buffer, offset: 0, seconds: buffer.duration };

  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));

  const threshold = peak * ONSET;
  let onset = 0;
  while (onset < data.length && Math.abs(data[onset]!) < threshold) onset += 1;
  // Back off a few milliseconds so the attack itself is not shaved off.
  onset = Math.max(0, onset - Math.round(buffer.sampleRate * 0.004));

  const offset = onset / buffer.sampleRate;
  return { buffer, offset, seconds: Math.min(CLIP_SECONDS, buffer.duration - offset) };
}

/** Plays one recording, if it arrived. Returns whether it did. */
function sample(ctx: AudioContext, cue: Cue, at = 0): boolean {
  const names = SAMPLES[cue];
  if (!names?.length) return false;
  const clip = clips.get(names[Math.floor(Math.random() * names.length)]!);
  if (!clip) return false;

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = clip.buffer;
  // A little detune each time. The ear notices a sound repeating exactly long
  // before it notices one repeating nearly.
  const rate = 0.94 + Math.random() * 0.12;
  source.playbackRate.value = rate;

  // Playing faster shortens the clip in real time, so the fade has to be placed
  // against the clock rather than against the buffer.
  const start = ctx.currentTime + at;
  const heard = clip.seconds / rate;
  const fade = Math.min(CLIP_FADE, heard / 2);
  gain.gain.setValueAtTime(SAMPLE_GAIN, start);
  gain.gain.setValueAtTime(SAMPLE_GAIN, start + heard - fade);
  gain.gain.linearRampToValueAtTime(0, start + heard);

  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(start, clip.offset, clip.seconds);
  return true;
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
  gain.gain.exponentialRampToValueAtTime(note.gain * TONE_GAIN, start + 0.008);
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
    case 'draw':
      // Never reached while the recordings are present; here so a browser that
      // could not decode them still hears something arrive.
      return [{ hz: semitone(-17), at: 0, seconds: 0.09, gain: 0.05, type: 'square' }];
    case 'turn':
      // Two notes rising a fifth, after the card has landed: the deck speaks
      // first, then the game says whose move it is.
      return [
        { hz: semitone(-5), at: 0.14, seconds: 0.12, gain: 0.045, type: 'triangle' },
        { hz: semitone(2), at: 0.23, seconds: 0.16, gain: 0.045, type: 'triangle' },
      ];
    case 'select':
      return [{ hz: semitone(-19), at: 0, seconds: 0.05, gain: 0.04, type: 'square' }];
    case 'place':
    case 'opponent':
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
    case 'reverse':
      // Only reached if the recording will not decode.
      return [
        { hz: semitone(-5), at: 0, seconds: 0.1, gain: 0.05, type: 'triangle' },
        { hz: semitone(7), at: 0.08, seconds: 0.18, gain: 0.05, type: 'triangle' },
      ];
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
    if (cue === 'opponent') {
      const now = performance.now();
      if (now - lastOpponent < OPPONENT_GAP_MS) return;
      lastOpponent = now;
    }
    try {
      if (sample(ctx, cue)) return;
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
