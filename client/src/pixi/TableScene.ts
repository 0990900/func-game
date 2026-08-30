/**
 * The card table.
 *
 * Sprites are keyed by card id and reused across updates — the legacy client
 * rebuilt its DOM on every broadcast, which is exactly what made animation
 * impossible. Keeping identity is what lets milestone E tween a card from where
 * it was to where it now belongs.
 */
import { Application, Container, Graphics, Rectangle, Text, TilingSprite } from 'pixi.js';
import { CARD_WIDTH, MIN_CARD_WIDTH, CardSprite, cardColor, metricsFor } from './CardSprite.ts';
import { EffectLayer } from './effects.ts';
import { dealIn, killTweens, moveTo, pulse } from './motion.ts';
import type { Point } from './motion.ts';
import type { TableTextures } from './assets.ts';
import { cardFace, statusName } from '../theme/meta.ts';
import { palette, toHexNumber } from '../theme/tokens.ts';
import type { Card, PublicState, Reveal } from '../../../src/core/types.ts';

const GAP = 12;
const PAD = 16;
/** A full hand. Cards shrink a little to keep it on one row when they nearly fit. */
const HAND_SIZE = 5;
/** Narrowest a fanned card's visible strip may get and still show its emblem. */
const FAN_MIN_STEP = 40;
const ROW_LABEL = 22;
const CHIP_HEIGHT = 30;

const LINE = toHexNumber(palette.line);
const MUTED = toHexNumber(palette.muted);
const TEXT = toHexNumber(palette.text);
const ACCENT = toHexNumber(palette.accent);

export interface TableCallbacks {
  readonly onSelectHand: (card: Card) => void;
  readonly onSelectMarket: (card: Card) => void;
  /** Tapping the table away from any card puts the current choice back. */
  readonly onCancel: () => void;
}

export interface TableInput {
  readonly state: PublicState;
  readonly selectedCardId: string | null;
  readonly selectedMarketId: string | null;
  /** Raised for a look, not yet chosen. Narrow screens only. */
  readonly previewCardId: string | null;
  readonly previewMarketId: string | null;
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
  /** Row headings are stable objects: recreating them every update leaked Text. */
  private readonly rowLabels = new Map<Container, Text>();
  /** Live sprites by card id, so identity survives a state update. */
  private readonly sprites = new Map<string, CardSprite>();
  private width: number;

  private readonly textures: TableTextures;
  private readonly callbacks: TableCallbacks;
  private readonly effects: EffectLayer;
  /** Where each card was last drawn, so a move can be tweened from it. */
  private readonly lastSeen = new Map<string, Point>();
  /** Where each player's chips start, so a flight has a destination. */
  private readonly seatAnchor = new Map<string, Point>();
  private lastRevealId: string | null = null;
  private lastCurrentPlayerId: string | null = null;
  /** Y of the market row inside the canvas, so the page can scroll to it. */
  private marketTop = 0;
  /** Card geometry the cached sprites were built at. */
  private geometryKey = '';
  /** Visible height of the canvas, and how tall the laid-out table is. */
  private viewportHeight = 0;
  private contentHeight = 0;
  private scrollY = 0;
  /** Asks the host whether the pointer has been dragged, so a scroll is not a tap. */
  private wasDragged: () => boolean = () => false;

  constructor(app: Application, textures: TableTextures, callbacks: TableCallbacks, width: number) {
    this.textures = textures;
    this.callbacks = callbacks;
    this.width = width;
    this.background = textures.tile
      ? new TilingSprite({ texture: textures.tile, width, height: 1 })
      : new Graphics();
    this.root.addChild(this.background, this.handLayer, this.marketLayer, this.areaLayer);
    app.stage.addChild(this.root);
    // Added last so a card in flight draws above the table, not under it.
    this.effects = new EffectLayer(app.stage, textures.particles);

    // The felt itself is a target. Cards sit in sibling layers above it, so it
    // only receives a tap that missed every card — which is what "empty space"
    // means here.
    this.background.eventMode = 'static';
    this.background.on('pointertap', () => {
      if (!this.wasDragged()) this.callbacks.onCancel();
    });
  }

  resize(width: number): void {
    this.width = width;
    if (this.background instanceof TilingSprite) this.background.width = width;
  }

  /**
   * The table owns a fixed row of the screen now, so when it is taller than
   * that row it scrolls itself rather than growing the page. This is the only
   * place the offset is applied, so nothing else has to know about it.
   */
  setViewport(width: number, viewportHeight: number, contentHeight: number): void {
    this.width = width;
    this.viewportHeight = viewportHeight;
    this.contentHeight = contentHeight;
    this.clampScroll();
  }

  setDragged(wasDragged: () => boolean): void {
    this.wasDragged = wasDragged;
  }

  /** Scrolls the table by a drag, in pixels. */
  scrollBy(delta: number): void {
    this.scrollY += delta;
    this.clampScroll();
  }

  /** Returns to the hand, which is where a cancelled pick starts again. */
  scrollToTop(): void {
    this.scrollY = 0;
    this.clampScroll();
  }

  /** Brings the market row to the top of the visible area. */
  revealMarket(): void {
    this.scrollY = this.marketTop - PAD;
    this.clampScroll();
  }

  private clampScroll(): void {
    const overflow = Math.max(0, this.contentHeight - this.viewportHeight);
    this.scrollY = Math.max(0, Math.min(overflow, this.scrollY));
    this.root.y = -this.scrollY;
  }

  /** Where the market row starts, in canvas pixels. */
  getMarketTop(): number {
    return this.marketTop;
  }

  /**
   * Card width for the current table width. A hand of five wraps to a stranded
   * second row at full size on a desktop column, so cards give up a few pixels
   * to stay on one line — but never below the width their text needs.
   */
  /** Wide enough to lay every row out flat, or narrow enough to need fanning. */
  private isNarrow(): boolean {
    return this.width <= 560;
  }

  private cardWidth(): number {
    const available = this.width - PAD * 2;
    const fitsFive = (available - (HAND_SIZE - 1) * GAP) / HAND_SIZE;
    const preferred = fitsFive >= MIN_CARD_WIDTH ? Math.min(CARD_WIDTH, Math.floor(fitsFive)) : CARD_WIDTH;
    // A fanned hand must also fit: the last card's right edge is the card's own
    // width past the strips of the four before it.
    const fitsFan = available - (HAND_SIZE - 1) * FAN_MIN_STEP;
    return Math.max(MIN_CARD_WIDTH, Math.min(preferred, fitsFan));
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) killTweens(sprite);
    this.effects.destroy();
    this.root.destroy({ children: true });
    this.sprites.clear();
    this.lastSeen.clear();
    this.rowLabels.clear();
  }

  /** Rebuilds layout from state, reusing every sprite whose card is still on the table. */
  update({ state, selectedCardId, selectedMarketId, previewCardId, previewMarketId }: TableInput): number {
    // Sprites bake their size, so a resize that changes card geometry has to
    // rebuild them rather than reuse cards drawn at the old dimensions.
    const geometryKey = `${this.cardWidth()}x${metricsFor(this.width).height}`;
    if (geometryKey !== this.geometryKey) {
      this.geometryKey = geometryKey;
      for (const sprite of this.sprites.values()) {
        killTweens(sprite);
        sprite.destroy({ children: true });
      }
      this.sprites.clear();
      this.lastSeen.clear();
    }

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
      raisedId: previewCardId,
      enabled: myTurn,
      onTap: this.callbacks.onSelectHand,
      fan: true,
    });

    this.marketTop = y + GAP;
    y = this.layoutRow({
      layer: this.marketLayer,
      title: '시장',
      cards: state.market,
      y: this.marketTop,
      seen,
      selectedId: selectedMarketId,
      raisedId: previewMarketId,
      // Market cards are inert until a hand card is chosen — the two-step pick.
      enabled: myTurn && Boolean(selectedCardId),
      onTap: this.callbacks.onSelectMarket,
      // Narrow screens fan the market too, so the table fits without scrolling.
      fan: this.isNarrow(),
    });

    y = this.layoutPlayAreas(state, y + GAP);

    // A card that left the hand or market is now a chip; fly the old sprite to
    // its new home before the chip takes over.
    this.flyReveal(state);

    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      killTweens(sprite);
      sprite.destroy();
      this.sprites.delete(id);
      this.lastSeen.delete(id);
    }

    // The table may be shorter than the row it sits in; the background still
    // covers the whole row so the felt does not stop mid-screen.
    const height = y + PAD;
    const painted = Math.max(height, this.viewportHeight);
    if (this.background instanceof TilingSprite) this.background.height = painted;
    else {
      this.background.clear().rect(0, 0, this.width, painted).fill(toHexNumber(palette.bg));
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
      metrics: metricsFor(this.width),
      width: this.cardWidth(),
    });
    sprite.suppressed = () => this.wasDragged();
    this.sprites.set(card.id, sprite);
    return sprite;
  }

  /**
   * How far apart fanned cards sit. Cards are only overlapped as much as the
   * width demands, and never so far that the container colour, glyph and name
   * on a card's left edge are covered.
   */
  private fanStep(count: number, cardWidth: number): number {
    if (count < 2) return cardWidth + GAP;
    // Spread to fill the row: the fan is as open as the width allows, and only
    // overlaps as much as it must.
    const spread = Math.floor((this.width - PAD * 2 - cardWidth) / (count - 1));
    return Math.min(cardWidth + GAP, Math.max(FAN_MIN_STEP, spread));
  }

  private layoutRow(options: {
    layer: Container;
    title: string;
    cards: readonly Card[];
    y: number;
    seen: Set<string>;
    selectedId: string | null;
    /** Lifted above its neighbours to be read, without being chosen. */
    raisedId?: string | null;
    enabled: boolean;
    onTap: (card: Card) => void;
    /** Overlap the cards like a held hand instead of laying them out in a grid. */
    fan?: boolean;
  }): number {
    const {
      layer, title, cards, y, seen, selectedId, raisedId = null, enabled, onTap, fan = false,
    } = options;
    // Detach only: the card sprites in here are reused and must not be destroyed.
    layer.removeChildren();

    let label = this.rowLabels.get(layer);
    if (!label) {
      label = heading(title);
      this.rowLabels.set(layer, label);
    }
    label.position.set(PAD, y);
    layer.addChild(label);

    const top = y + ROW_LABEL;
    const cardHeight = metricsFor(this.width).height;
    const cardWidth = this.cardWidth();
    const step = fan ? this.fanStep(cards.length, cardWidth) : cardWidth + GAP;
    const perRow = fan
      ? cards.length || 1
      : Math.max(1, Math.floor((this.width - PAD * 2 + GAP) / (cardWidth + GAP)));

    cards.forEach((card, index) => {
      const existed = this.sprites.has(card.id);
      const sprite = this.spriteFor(card, onTap);
      seen.add(card.id);
      sprite.setSelected(card.id === selectedId);
      sprite.setEnabled(enabled);

      // Previewed and chosen cards both come forward; only the chosen one is
      // outlined, so a look is never mistaken for a decision.
      const raised = sprite.isSelected() || card.id === raisedId;

      const column = index % perRow;
      const row = Math.floor(index / perRow);
      // A raised card lifts clear of its neighbours — further when fanned,
      // where the lift is what separates it from the cards it overlaps.
      const lift = raised ? (fan ? 16 : 5) : 0;
      const target: Point = {
        x: PAD + column * step,
        y: top + row * (cardHeight + GAP) - lift,
      };
      layer.addChild(sprite);

      if (fan) {
        // Later cards overlap earlier ones, and a raised card sits above them
        // all so it can be read whole.
        sprite.zIndex = raised ? cards.length + 1 : index;
        // Each card stays tappable at its own slot, even while another is drawn
        // over it. Without this a raised card swallows the strips of the cards
        // to its right and they cannot be reached at all.
        const isLast = index === cards.length - 1;
        sprite.hitArea = new Rectangle(0, 0, isLast ? cardWidth : step, cardHeight);
      }

      if (!existed) {
        sprite.position.set(target.x, target.y);
        dealIn(sprite, index);
      } else if (sprite.x !== target.x || sprite.y !== target.y) {
        // Reused sprite: tween from where it already is rather than jumping.
        moveTo(sprite, target);
      }
      this.lastSeen.set(card.id, { ...target });
    });

    if (fan) layer.sortableChildren = true;

    const rows = Math.max(1, Math.ceil(cards.length / perRow));
    // Room for the lift so a raised card is not clipped by the row below.
    return top + rows * (cardHeight + GAP) + (fan ? 16 : 0);
  }

  private layoutPlayAreas(state: PublicState, startY: number): number {
    // Chips and their labels are rebuilt every update, so the old ones are
    // destroyed rather than just detached — detaching alone left them alive and
    // they reappeared as ghosts at the foot of the table.
    for (const child of this.areaLayer.removeChildren()) child.destroy();
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
      if (isCurrent && state.currentPlayerId !== this.lastCurrentPlayerId) pulse(name);
      y += 20;

      // Where a card flying to this player should land.
      this.seatAnchor.set(player.id, { x: PAD + 40, y: y + 12 });

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
    this.lastCurrentPlayerId = state.currentPlayerId;
    return y;
  }

  /**
   * Animates the card the server just revealed, from wherever it last sat to
   * the seat that played it. `lastReveal` has been in publicState all along;
   * this is its first use.
   */
  private flyReveal(state: PublicState): void {
    const reveal: Reveal | undefined = state.lastReveal[0];
    if (!reveal) return;

    // One flight per reveal — publicState resends the same one on every
    // broadcast, including those a bot timer triggers.
    const revealId = `${reveal.playerId}:${reveal.card.id}`;
    if (revealId === this.lastRevealId) return;
    this.lastRevealId = revealId;

    const destination = this.seatAnchor.get(reveal.playerId);
    if (!destination) return;

    const emblemKey = reveal.card.kind.includes('wildcard') ? 'wildcard' : reveal.card.container;
    const metrics = metricsFor(this.width);
    this.effects.flyCard(
      reveal.card,
      // A card played from a hidden hand has no last-known seat: drop it in.
      this.lastSeen.get(reveal.card.id) ?? { x: this.width / 2 - this.cardWidth() / 2, y: -metrics.height },
      { x: destination.x - this.cardWidth() / 4, y: destination.y - metrics.height / 4 },
      this.textures.emblems[emblemKey as 'wildcard'],
      metrics,
      this.cardWidth(),
    );

    if (state.players.find((player) => player.id === reveal.playerId)?.status === 'claiming') {
      this.effects.celebrate(destination, cardColor(reveal.card));
    }
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
