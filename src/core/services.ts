import { Context, Layer } from 'effect';

/** Source of randomness for shuffling and bot tie-breaking. */
export class Rng extends Context.Tag('core/Rng')<Rng, {
  readonly next: () => number;
}>() {}

/** Generates entity ids (`room-`, `player-`, `bot-`, `event-` prefixes). */
export class IdGen extends Context.Tag('core/IdGen')<IdGen, {
  readonly make: (prefix: string) => string;
}>() {}

/** Wall clock. Injectable so tests can hold time still and stamp deadlines. */
export class Clock extends Context.Tag('core/Clock')<Clock, {
  readonly now: () => number;
}>() {}

export const RngLive = Layer.succeed(Rng, { next: Math.random });

export const ClockLive = Layer.succeed(Clock, { now: Date.now });

/** Fixed clock for tests: deadlines become predictable numbers. */
export const clockFrom = (now: () => number): Layer.Layer<Clock> => Layer.succeed(Clock, { now });

/** Deterministic Rng for tests and golden comparisons. */
export const rngFrom = (next: () => number): Layer.Layer<Rng> => Layer.succeed(Rng, { next });

const hex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const IdGenLive = Layer.succeed(IdGen, { make: (prefix) => `${prefix}-${hex(4)}` });

/** Sequential ids for tests: `room-1`, `player-2`, ... */
export const idGenSequential = (): Layer.Layer<IdGen> => {
  let seq = 0;
  return Layer.succeed(IdGen, { make: (prefix) => `${prefix}-${++seq}` });
};
