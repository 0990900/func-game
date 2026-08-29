/**
 * One card, drawn. Geometry mirrors the DOM card so the two renderers look the
 * same: offset shadow, container-coloured border, a decorative ring clipped to
 * the card, sigil and kind on top, then the operation glyph, label and hint.
 *
 * Korean hint text uses `Text`, never `BitmapText` — a CJK glyph atlas can
 * exceed the GPU texture limit.
 */
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { TextStyleOptions } from 'pixi.js';
import { cardFace } from '../theme/meta.ts';
import { containerColor, palette, toHexNumber, utilityColor, wildcardColor } from '../theme/tokens.ts';
import type { Card, ContainerName } from '../../../src/core/types.ts';

export const CARD_WIDTH = 148;
export const CARD_HEIGHT = 190;
const RADIUS = 4;

const SURFACE = toHexNumber(palette.surface2);
const MUTED = toHexNumber(palette.muted);
const TEXT = toHexNumber(palette.text);
const ACCENT = toHexNumber(palette.accent);

export function cardColor(card: Card): number {
  if (card.kind === 'utility') return toHexNumber(utilityColor);
  if (card.kind.includes('wildcard')) return toHexNumber(wildcardColor);
  const color = containerColor[card.container as ContainerName];
  return color ? toHexNumber(color) : toHexNumber(palette.line);
}

const label = (options: Partial<TextStyleOptions>): TextStyleOptions => ({
  fontFamily: '"Avenir Next", "Noto Sans KR", sans-serif',
  fill: TEXT,
  ...options,
});

export interface CardSpriteOptions {
  readonly card: Card;
  readonly emblem?: Texture | undefined;
  readonly onTap?: ((card: Card) => void) | undefined;
}

export class CardSprite extends Container {
  readonly card: Card;
  private readonly frame = new Graphics();
  private readonly highlight = new Graphics();
  private selected = false;
  private enabled = true;

  constructor({ card, emblem, onTap }: CardSpriteOptions) {
    super();
    this.card = card;
    const tint = cardColor(card);
    const face = cardFace(card);

    this.addChild(this.frame, this.highlight);
    this.drawFrame(tint);

    // The decorative ring is clipped to the card, matching the DOM ::after.
    const ring = new Graphics()
      .circle(CARD_WIDTH - 6, CARD_HEIGHT + 2, 55)
      .stroke({ width: 18, color: tint, alpha: 0.1 });
    const mask = new Graphics().roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, RADIUS).fill(0xffffff);
    ring.mask = mask;
    this.addChild(ring, mask);

    if (emblem) {
      const badge = new Sprite(emblem);
      badge.width = 22;
      badge.height = 22;
      badge.position.set(11, 11);
      this.addChild(badge);
    } else {
      const sigil = new Text({
        text: face.containerSymbol,
        style: label({ fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: '800', fill: tint }),
      });
      sigil.position.set(11, 10);
      this.addChild(sigil);
    }

    const kind = new Text({
      text: face.kindLabel.toUpperCase(),
      style: label({ fontSize: 11, fontWeight: '800', letterSpacing: 1, fill: MUTED }),
    });
    kind.anchor.set(1, 0);
    kind.position.set(CARD_WIDTH - 11, 14);
    this.addChild(kind);

    const glyph = new Text({
      text: face.operationSymbol,
      style: label({ fontFamily: 'Georgia, serif', fontSize: 38, fontWeight: '700', fill: tint }),
    });
    glyph.position.set(11, 52);
    this.addChild(glyph);

    const name = new Text({
      text: face.operationLabel,
      style: label({ fontSize: 19, fontWeight: '900', wordWrap: true, wordWrapWidth: CARD_WIDTH - 22 }),
    });
    name.position.set(11, 104);
    this.addChild(name);

    const hint = new Text({
      text: face.hint,
      style: label({ fontSize: 12, fill: 0xc7d1db, wordWrap: true, wordWrapWidth: CARD_WIDTH - 22, lineHeight: 16 }),
    });
    hint.position.set(11, 134);
    this.addChild(hint);

    if (onTap) {
      this.eventMode = 'static';
      this.cursor = 'pointer';
      this.on('pointertap', () => { if (this.enabled) onTap(card); });
    }
  }

  private drawFrame(tint: number): void {
    this.frame
      .clear()
      .roundRect(4, 5, CARD_WIDTH, CARD_HEIGHT, RADIUS)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, RADIUS)
      .fill(SURFACE)
      .stroke({ width: 1, color: tint });
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.highlight.clear();
    if (selected) {
      this.highlight
        .roundRect(-3, -3, CARD_WIDTH + 6, CARD_HEIGHT + 6, RADIUS + 2)
        .stroke({ width: 3, color: ACCENT });
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.alpha = enabled ? 1 : 0.45;
    this.cursor = enabled ? 'pointer' : 'default';
  }

  isSelected(): boolean {
    return this.selected;
  }
}
