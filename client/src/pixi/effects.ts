/**
 * Cross-zone effects: a card flying from where it was played to where it
 * landed, and the burst when a combo is claimed.
 *
 * Both run in a screen-space overlay container that sits above the layout and
 * is never measured by it, so an in-flight sprite cannot widen the canvas or
 * the document. This is the canvas equivalent of a `position: fixed` layer.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { CardSprite } from './CardSprite.ts';
import type { CardMetrics } from './CardSprite.ts';
import { prefersReducedMotion, seconds } from './motion.ts';
import type { Point } from './motion.ts';
import type { Card } from '../../../src/core/types.ts';

export interface Particles {
  readonly glow: Texture | null;
  readonly ring: Texture | null;
  readonly sparkle: Texture | null;
}

export class EffectLayer {
  private readonly layer = new Container();
  private readonly particles: Particles;
  /**
   * Every timeline this layer started. Killing tweens by target is not enough:
   * these animate `sprite.scale` and `star.position`, which are objects of
   * their own, so a kill aimed at the sprites leaves them running against
   * transforms that no longer exist.
   */
  private readonly timelines = new Set<gsap.core.Timeline>();

  constructor(stage: Container, particles: Particles) {
    this.particles = particles;
    // Above everything, and never part of the measured layout.
    this.layer.eventMode = 'none';
    stage.addChild(this.layer);
  }

  destroy(): void {
    for (const timeline of this.timelines) timeline.kill();
    this.timelines.clear();
    this.layer.destroy({ children: true });
  }

  /**
   * Flies a copy of `card` from `from` to `to`, then fades it out so the chip
   * underneath takes over. A no-op under reduced motion — the state is already
   * correct without it.
   */
  flyCard(
    card: Card,
    from: Point,
    to: Point,
    emblem?: Texture | undefined,
    metrics?: CardMetrics | undefined,
    width?: number | undefined,
  ): void {
    if (prefersReducedMotion()) return;

    const sprite = new CardSprite({ card, emblem, metrics, width });
    sprite.position.set(from.x, from.y);
    sprite.alpha = 0.96;
    this.layer.addChild(sprite);

    const timeline = gsap.timeline({
      onComplete: () => {
        this.timelines.delete(timeline);
        sprite.destroy({ children: true });
      },
    });
    this.timelines.add(timeline);
    timeline
      .to(sprite, { x: to.x, y: to.y, duration: seconds(0.46), ease: 'power2.inOut' }, 0)
      .to(sprite.scale, { x: 0.28, y: 0.28, duration: seconds(0.46), ease: 'power2.inOut' }, 0)
      .to(sprite, { alpha: 0, duration: seconds(0.16), ease: 'power1.in' }, seconds(0.34));
  }

  /** A burst of light where a combo was claimed. */
  celebrate(at: Point, tint: number): void {
    if (prefersReducedMotion()) return;

    const { glow, ring, sparkle } = this.particles;

    if (glow) this.burstOne(glow, at, tint, { scale: 1.6, duration: 0.6 });
    if (ring) this.burstOne(ring, at, tint, { scale: 2.4, duration: 0.7 });

    if (!sparkle) return;
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
      const distance = 42 + Math.random() * 34;
      const star = new Sprite(sparkle);
      star.anchor.set(0.5);
      star.tint = tint;
      star.blendMode = 'add';
      star.position.set(at.x, at.y);
      star.scale.set(0.22);
      this.layer.addChild(star);

      const spark = gsap.timeline({
        onComplete: () => {
          this.timelines.delete(spark);
          star.destroy();
        },
      });
      this.timelines.add(spark);
      spark
        .to(star.position, {
          x: at.x + Math.cos(angle) * distance,
          y: at.y + Math.sin(angle) * distance,
          duration: seconds(0.6),
          ease: 'power2.out',
        }, 0)
        .to(star, { alpha: 0, duration: seconds(0.6), ease: 'power1.in' }, 0);
    }
  }

  private burstOne(
    texture: Texture,
    at: Point,
    tint: number,
    options: { scale: number; duration: number },
  ): void {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.tint = tint;
    // Additive blending is why the source art is white on black: the black
    // reads as transparent and the tint carries the colour.
    sprite.blendMode = 'add';
    sprite.position.set(at.x, at.y);
    sprite.scale.set(0.2);
    sprite.alpha = 0.85;
    this.layer.addChild(sprite);

    const timeline = gsap.timeline({
      onComplete: () => {
        this.timelines.delete(timeline);
        sprite.destroy();
      },
    });
    this.timelines.add(timeline);
    timeline
      .to(sprite.scale, { x: options.scale, y: options.scale, duration: seconds(options.duration), ease: 'power2.out' }, 0)
      .to(sprite, { alpha: 0, duration: seconds(options.duration), ease: 'power1.in' }, 0);
  }
}
