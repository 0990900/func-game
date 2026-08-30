/**
 * Motion primitives for the table.
 *
 * Every duration passes through `seconds()`, so honouring the viewer's
 * reduced-motion setting is one decision made once: animations snap to their
 * end state instead of being skipped, which keeps the final layout identical
 * either way.
 */
import { gsap } from 'gsap';

const query = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export const prefersReducedMotion = (): boolean => query?.matches ?? false;

/** Collapses to 0 when the viewer asked for reduced motion. */
export const seconds = (value: number): number => (prefersReducedMotion() ? 0 : value);

export interface Point { x: number; y: number }

/** Slides a display object to a position. */
export function moveTo(
  target: { x: number; y: number },
  to: Point,
  duration = 0.32,
  delay = 0,
): gsap.core.Tween {
  return gsap.to(target, {
    x: to.x,
    y: to.y,
    duration: seconds(duration),
    delay: seconds(delay),
    ease: 'power2.out',
    overwrite: 'auto',
  });
}

/**
 * Fades and lifts a newly dealt card into place. It settles at the alpha the
 * card already has, so a card dealt while it is un-playable stays dimmed
 * instead of the tween fighting the enabled/disabled state.
 */
export function dealIn(target: { alpha: number; y: number }, index: number): gsap.core.Tween {
  const restingY = target.y;
  const restingAlpha = target.alpha;
  target.alpha = 0;
  target.y = restingY + 18;
  return gsap.to(target, {
    alpha: restingAlpha,
    y: restingY,
    duration: seconds(0.3),
    delay: seconds(Math.min(index, 6) * 0.04),
    ease: 'power2.out',
  });
}

/** A short pulse to draw the eye — used when the turn changes. */
export function pulse(target: { alpha: number }): gsap.core.Tween {
  if (prefersReducedMotion()) {
    target.alpha = 1;
    return gsap.to(target, { alpha: 1, duration: 0 });
  }
  return gsap.fromTo(
    target,
    { alpha: 0.35 },
    { alpha: 1, duration: 0.45, ease: 'power2.out' },
  );
}

/**
 * Stops every tween touching a display object, including the ones aimed at its
 * parts. `flip` animates `scale`, which `killTweensOf(sprite)` does not reach:
 * a card turned over as the scene was torn down kept writing to a destroyed
 * object and held it alive until the timeline ran out.
 */
export const killTweens = (target: { scale?: unknown; position?: unknown }): void => {
  gsap.killTweensOf(target);
  if (target.scale) gsap.killTweensOf(target.scale);
  if (target.position) gsap.killTweensOf(target.position);
};

/**
 * Turns a card over: squash to nothing, swap the side, and open again.
 *
 * The swap happens at the midpoint, where the card has no width, so the two
 * sides are never both visible. Under reduced motion both halves collapse to
 * zero and the swap still runs, which is why it is a callback rather than
 * something the caller does before or after.
 */
export function flip(
  target: { scale: { x: number } },
  swap: () => void,
): gsap.core.Timeline {
  const half = seconds(0.13);
  return gsap.timeline()
    .to(target.scale, { x: 0, duration: half, ease: 'power2.in' })
    .call(swap)
    .to(target.scale, { x: 1, duration: half, ease: 'power2.out' });
}
