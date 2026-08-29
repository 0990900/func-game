import { Context, Layer } from 'effect';

/** Source of randomness for shuffling and bot tie-breaking. */
export class Rng extends Context.Tag('core/Rng')<Rng, {
  readonly next: () => number;
}>() {}

/** Generates entity ids (`room-`, `player-`, `bot-`, `event-` prefixes). */
export class IdGen extends Context.Tag('core/IdGen')<IdGen, {
  readonly make: (prefix: string) => string;
}>() {}

export const RngLive = Layer.succeed(Rng, { next: Math.random });

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
