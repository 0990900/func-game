/**
 * Art loading. Every texture is optional: if a file is missing or fails to
 * decode, the table falls back to drawn shapes rather than showing nothing.
 */
import { Assets, Texture } from 'pixi.js';
import type { ContainerName } from '../../../src/core/types.ts';

const BASE = 'assets';

export interface TableTextures {
  readonly tile: Texture | null;
  readonly cardBack: Texture | null;
  readonly emblems: Partial<Record<ContainerName | 'wildcard', Texture>>;
  readonly particles: {
    readonly glow: Texture | null;
    readonly ring: Texture | null;
    readonly sparkle: Texture | null;
  };
}

async function tryLoad(file: string): Promise<Texture | null> {
  try {
    return await Assets.load<Texture>(`${BASE}/${file}`);
  } catch {
    return null;
  }
}

/**
 * Korean card text is rendered with Pixi `Text`, which measures glyphs at
 * construction — so the fonts must be ready before the first card is built or
 * the labels bake at fallback metrics.
 */
export async function waitForFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.all([
      document.fonts.load('700 39px Georgia'),
      document.fonts.load('900 20px "Avenir Next"'),
      document.fonts.load('13px "Noto Sans KR"'),
    ]);
    await document.fonts.ready;
  } catch {
    // Font loading is best-effort; the fallback stack still renders.
  }
}

export async function loadTableTextures(): Promise<TableTextures> {
  const [tile, cardBack, maybe, either, list, task, wildcard, glow, ring, sparkle] = await Promise.all([
    tryLoad('table-tile.webp'),
    tryLoad('card-back.webp'),
    tryLoad('emblem-maybe.webp'),
    tryLoad('emblem-either.webp'),
    tryLoad('emblem-list.webp'),
    tryLoad('emblem-task.webp'),
    tryLoad('emblem-wildcard.webp'),
    tryLoad('particle-glow.webp'),
    tryLoad('particle-ring.webp'),
    tryLoad('particle-sparkle.webp'),
  ]);

  const emblems: Partial<Record<ContainerName | 'wildcard', Texture>> = {};
  if (maybe) emblems.Maybe = maybe;
  if (either) emblems.Either = either;
  if (list) emblems.List = list;
  if (task) emblems.Task = task;
  if (wildcard) emblems.wildcard = wildcard;

  return { tile, cardBack, emblems, particles: { glow, ring, sparkle } };
}
