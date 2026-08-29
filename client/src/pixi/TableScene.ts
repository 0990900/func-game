/**
 * The card table.
 *
 * Sprites are keyed by card id and reused across updates — the legacy client
 * rebuilt its DOM on every broadcast, which is exactly what made animation
 * impossible. Keeping identity is what lets milestone E tween a card from where
 * it was to where it now belongs.
 */
import { Application, Container, Graphics, Text, TilingSprite } from 'pixi.js';
import { CARD_HEIGHT, CARD_WIDTH, CardSprite, cardColor } from './CardSprite.ts';
import type { TableTextures } from './assets.ts';
import { cardFace, statusName } from '../theme/meta.ts';
import { palette, toHexNumber } from '../theme/tokens.ts';
import type { Card, PublicState } from '../../../src/core/types.ts';

const GAP = 12;
const PAD = 16;
const ROW_LABEL = 22;
const CHIP_HEIGHT = 30;

const LINE = toHexNumber(palette.line);
const MUTED = toHexNumber(palette.muted);
const TEXT = toHexNumber(palette.text);
const ACCENT = toHexNumber(palette.accent);

export interface TableCallbacks {
  readonly onSelectHand: (card: Card) => void;
  readonly onSelectMarket: (card: Card) => void;
}

export interface TableInput {
  readonly state: PublicState;
  readonly selectedCardId: string | null;
  readonly selectedMarketId: string | null;
}

const heading = (text: string, color = MUTED) =>
  new Text({
    text,
    style: {
      fontFamily: '"Avenir Next", "Noto Sans KR", sans-serif',
      fontSize: 12, fontWeight: '900', letterSpacing: 1.4, fill: color,
    },
  });

const body = (text: string, size = 13, color = TEXT) =>
  new Text({
    text,
    style: { fontFamily: '"Avenir Next", "Noto Sans KR", sans-serif', fontSize: size, fill: color },
  });

export class TableScene {
  private readonly root = new Container();
  private readonly background: TilingSprite | Graphics;
  private readonly handLayer = new Container();
  private readonly marketLayer = new Container();
  private readonly areaLayer = new Container();
  /** Live sprites by card id, so identity survives a state update. */
  private readonly sprites = new Map<string, CardSprite>();
  private width: number;

  private readonly textures: TableTextures;
  private readonly callbacks: TableCallbacks;

  constructor(app: Application, textures: TableTextures, callbacks: TableCallbacks, width: number) {
    this.textures = textures;
    this.callbacks = callbacks;
    this.width = width;
    this.background = textures.tile
      ? new TilingSprite({ texture: textures.tile, width, height: 1 })
      : new Graphics();
    this.root.addChild(this.background, this.handLayer, this.marketLayer, this.areaLayer);
    app.stage.addChild(this.root);
  }

  resize(width: number): void {
    this.width = width;
    if (this.background instanceof TilingSprite) this.background.width = width;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.sprites.clear();
  }

  /** Rebuilds layout from state, reusing every sprite whose card is still on the table. */
  update({ state, selectedCardId, selectedMarketId }: TableInput): number {
    const myTurn = Boolean(state.me?.isMyTurn);
    const seen = new Set<string>();
    let y = PAD;

    y = this.layoutRow({
      layer: this.handLayer,
      title: '내 손패',
      cards: state.me?.hand ?? [],
      y,
      seen,
      selectedId: selectedCardId,
      enabled: myTurn,
      onTap: this.callbacks.onSelectHand,
    });

    y = this.layoutRow({
      layer: this.marketLayer,
      title: '시장',
      cards: state.market,
      y: y + GAP,
      seen,
      selectedId: selectedMarketId,
      // Market cards are inert until a hand card is chosen — the two-step pick.
      enabled: myTurn && Boolean(selectedCardId),
      onTap: this.callbacks.onSelectMarket,
    });

    y = this.layoutPlayAreas(state, y + GAP);

    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }

    const height = y + PAD;
    if (this.background instanceof TilingSprite) this.background.height = height;
    else {
      this.background.clear().rect(0, 0, this.width, height).fill(toHexNumber(palette.bg));
    }
    return height;
  }

  private spriteFor(card: Card, onTap: (card: Card) => void): CardSprite {
    const existing = this.sprites.get(card.id);
    if (existing) return existing;
    const emblemKey = card.kind.includes('wildcard') ? 'wildcard' : card.container;
    const sprite = new CardSprite({
      card,
      emblem: this.textures.emblems[emblemKey as 'wildcard'],
      onTap,
    });
    this.sprites.set(card.id, sprite);
    return sprite;
  }

  private layoutRow(options: {
    layer: Container;
    title: string;
    cards: readonly Card[];
    y: number;
    seen: Set<string>;
    selectedId: string | null;
    enabled: boolean;
    onTap: (card: Card) => void;
  }): number {
    const { layer, title, cards, y, seen, selectedId, enabled, onTap } = options;
    layer.removeChildren();

    const label = heading(title);
    label.position.set(PAD, y);
    layer.addChild(label);

    const top = y + ROW_LABEL;
    // The row scrolls inside the canvas rather than widening it.
    const perRow = Math.max(1, Math.floor((this.width - PAD * 2 + GAP) / (CARD_WIDTH + GAP)));

    cards.forEach((card, index) => {
      const sprite = this.spriteFor(card, onTap);
      seen.add(card.id);
      sprite.setSelected(card.id === selectedId);
      sprite.setEnabled(enabled);
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      sprite.position.set(
        PAD + column * (CARD_WIDTH + GAP),
        top + row * (CARD_HEIGHT + GAP) - (sprite.isSelected() ? 5 : 0),
      );
      layer.addChild(sprite);
    });

    const rows = Math.max(1, Math.ceil(cards.length / perRow));
    return top + rows * (CARD_HEIGHT + GAP);
  }

  private layoutPlayAreas(state: PublicState, startY: number): number {
    this.areaLayer.removeChildren();
    let y = startY;

    const label = heading('플레이 영역');
    label.position.set(PAD, y);
    this.areaLayer.addChild(label);
    y += ROW_LABEL;

    for (const player of state.players) {
      const isMe = player.id === state.me?.id;
      const isCurrent = state.currentPlayerId === player.id;

      const name = body(
        `${player.name}${player.bot ? ' (Bot)' : ''} · ${statusName(player.status)} · ${player.publicScore.total}점`,
        13,
        isCurrent ? ACCENT : isMe ? TEXT : MUTED,
      );
      name.position.set(PAD, y);
      this.areaLayer.addChild(name);
      y += 20;

      if (player.playArea.length === 0) {
        const empty = body('아직 없음', 12, MUTED);
        empty.position.set(PAD, y);
        this.areaLayer.addChild(empty);
        y += CHIP_HEIGHT;
      } else {
        y = this.layoutChips(player.playArea, y);
      }
      y += GAP;
    }
    return y;
  }

  private layoutChips(cards: readonly Card[], startY: number): number {
    let x = PAD;
    let y = startY;

    for (const card of cards) {
      const face = cardFace(card);
      const tint = cardColor(card);
      const text = body(`${face.containerSymbol} ${card.label}`, 12);
      const width = text.width + 18;

      if (x + width > this.width - PAD) {
        x = PAD;
        y += CHIP_HEIGHT;
      }

      const chip = new Graphics()
        .roundRect(x, y, width, 24, 3)
        .fill({ color: tint, alpha: 0.08 })
        .stroke({ width: 1, color: tint });
      text.position.set(x + 9, y + 5);
      this.areaLayer.addChild(chip, text);
      x += width + 8;
    }
    return y + CHIP_HEIGHT;
  }
}
