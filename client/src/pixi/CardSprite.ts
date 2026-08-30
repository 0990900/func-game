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
/** Below this a card cannot hold its label and hint legibly. */
export const MIN_CARD_WIDTH = 118;
const RADIUS = 4;

/**
 * Vertical rhythm inside a card. The compact variant is for phones, where the
 * hand wraps to three rows and every card's height is paid three times.
 */
export interface CardMetrics {
  readonly height: number;
  readonly glyphSize: number;
  readonly glyphY: number;
  readonly nameY: number;
  readonly hintY: number;
}

const ROOMY: CardMetrics = { height: 190, glyphSize: 38, glyphY: 52, nameY: 104, hintY: 134 };
const COMPACT: CardMetrics = { height: 156, glyphSize: 30, glyphY: 44, nameY: 84, hintY: 110 };

/**
 * Cards get shorter once the table itself is narrow. This measures the table,
 * not the window: a side panel opening shrinks the table without the viewport
 * changing, and the cards should follow the space they actually have.
 */
export const metricsFor = (width: number): CardMetrics => (width <= 420 ? COMPACT : ROOMY);

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
  readonly metrics?: CardMetrics | undefined;
  readonly width?: number | undefined;
}

export class CardSprite extends Container {
  readonly card: Card;
  private readonly frame = new Graphics();
  private readonly highlight = new Graphics();
  /** Dims a card that cannot be played, without making it see-through. */
  private readonly veil = new Graphics();
  private selected = false;
  private enabled = true;

  /** Not `height`: that name belongs to Pixi's Container. */
  readonly cardHeight: number;
  private readonly metrics: CardMetrics;

  readonly cardWidth: number;
  /** Set by the scene so a drag can cancel the tap it ends with. */
  suppressed: () => boolean = () => false;
  /**
   * Where a tap goes. It is reassignable because a card outlives its row: a
   * market swap moves the played card into the market, and the sprite is reused
   * there. Baking the handler in at construction left it reporting a market
   * card as a hand pick.
   */
  private onTap: ((card: Card) => void) | null = null;

  constructor({ card, emblem, onTap, metrics = ROOMY, width = CARD_WIDTH }: CardSpriteOptions) {
    super();
    this.card = card;
    this.metrics = metrics;
    this.cardHeight = metrics.height;
    this.cardWidth = width;
    const tint = cardColor(card);
    const face = cardFace(card);

    this.addChild(this.frame, this.highlight);
    this.drawFrame(tint);

    // The decorative ring is clipped to the card, matching the DOM ::after.
    const ring = new Graphics()
      .circle(width - 6, metrics.height + 2, 55)
      .stroke({ width: 18, color: tint, alpha: 0.1 });
    const mask = new Graphics().roundRect(0, 0, width, metrics.height, RADIUS).fill(0xffffff);
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
    kind.position.set(width - 11, 14);
    this.addChild(kind);

    const glyph = new Text({
      text: face.operationSymbol,
      style: label({ fontFamily: 'Georgia, serif', fontSize: metrics.glyphSize, fontWeight: '700', fill: tint }),
    });
    glyph.position.set(11, metrics.glyphY);
    this.addChild(glyph);

    const name = new Text({
      text: face.operationLabel,
      style: label({ fontSize: 19, fontWeight: '900', wordWrap: true, wordWrapWidth: width - 22 }),
    });
    name.position.set(11, metrics.nameY);
    this.addChild(name);

    const hint = new Text({
      text: face.hint,
      style: label({ fontSize: 12, fill: 0xc7d1db, wordWrap: true, wordWrapWidth: width - 22, lineHeight: 16 }),
    });
    hint.position.set(11, metrics.hintY);
    this.addChild(hint);

    // Above the card's own contents, below nothing else.
    this.addChild(this.veil);
    this.drawVeil();

    this.setOnTap(onTap ?? null);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      // A tap that was really the end of a scroll must not choose a card.
      if (this.enabled && !this.suppressed()) this.onTap?.(this.card);
    });
  }

  private drawFrame(tint: number): void {
    const { height } = this.metrics;
    this.frame
      .clear()
      .roundRect(4, 5, this.cardWidth, height, RADIUS)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(0, 0, this.cardWidth, height, RADIUS)
      .fill(SURFACE)
      .stroke({ width: 1, color: tint });
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.highlight.clear();
    if (selected) {
      this.highlight
        .roundRect(-3, -3, this.cardWidth + 6, this.metrics.height + 6, RADIUS + 2)
        .stroke({ width: 3, color: ACCENT });
    }
  }

  setOnTap(onTap: ((card: Card) => void) | null): void {
    this.onTap = onTap;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Not `alpha`: a fanned card overlaps its neighbours, and a see-through
    // card lets the ones beneath bleed through into unreadable mush.
    this.veil.visible = !enabled;
    this.cursor = enabled ? 'pointer' : 'default';
  }

  private drawVeil(): void {
    this.veil
      .clear()
      .roundRect(0, 0, this.cardWidth, this.metrics.height, RADIUS)
      .fill({ color: 0x0b1016, alpha: 0.62 });
    this.veil.visible = false;
  }

  isSelected(): boolean {
    return this.selected;
  }
}
