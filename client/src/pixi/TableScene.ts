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
import { containerMeta, statusName } from '../theme/meta.ts';
import { containerColor, palette, toHexNumber, utilityColor, wildcardColor } from '../theme/tokens.ts';
import { containers, createDeck } from '../../../src/core/cards.ts';
import { coveredOperations } from '../../../src/core/combos.ts';
import { isNarrow } from '../ui/viewport.ts';
import type { Card, ContainerName, PublicState, Reveal } from '../../../src/core/types.ts';

const GAP = 12;
const PAD = 16;
/** Chips snap to a column grid so their left edges line up down the rows. */
const CHIP_GAP = 6;
/* A container's whole slot set goes on one line, so every play area is the
   same shape and they can be compared down the column. Six is the widest set
   any container has. */
const SLOT_COUNT = 6;
const SLOT_GAP = 4;
const SLOT_ROW = 26;
/** Just the container's sigil: the row's position and colour say the rest. */
const GROUP_LABEL_WIDTH = 30;
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
const EMPTY_SLOT = toHexNumber(palette.line);

export interface TableCallbacks {
  readonly onSelectHand: (card: Card) => void;
  readonly onSelectMarket: (card: Card) => void;
  /** Tapping the table away from any card puts the current choice back. */
  readonly onCancel: () => void;
}

/**
 * The operations each container can hold, in the order they are wanted: the
 * base ladder to Monad first, then that container's specials. Derived from the
 * deck rather than restated, so a card added to the rules gets a slot here.
 */
const CONTAINER_SLOTS: Record<string, string[]> = (() => {
  const ladder = ['map', 'ap', 'pure', 'chain'];
  const deck = createDeck();
  const slots: Record<string, string[]> = {};
  for (const container of containers) {
    const present = [...new Set(
      deck
        .filter((card) => card.kind === 'container-function' && card.container === container)
        .map((card) => card.operation),
    )];
    slots[container] = [
      ...ladder.filter((operation) => present.includes(operation)),
      ...present.filter((operation) => !ladder.includes(operation)).sort(),
    ];
  }
  return slots;
})();

/** One cell of a container's slot row. */
interface SlotCell {
  readonly text: string;
  readonly state: 'owned' | 'covered' | 'empty';
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
  private cardWidth(): number {
    const available = this.width - PAD * 2;
    const fitsFive = (available - (HAND_SIZE - 1) * GAP) / HAND_SIZE;
    const preferred = fitsFive >= MIN_CARD_WIDTH ? Math.min(CARD_WIDTH, Math.floor(fitsFive)) : CARD_WIDTH;
    // A fanned hand must also fit: the last card's right edge is the card's own
    // width past the strips of the four before it.
    const fitsFan = available - (HAND_SIZE - 1) * FAN_MIN_STEP;
    const width = Math.max(MIN_CARD_WIDTH, Math.min(preferred, fitsFan));
    // On a very narrow screen even the minimum will not fit, and the row is
    // clipped with no way to scroll to what is off the edge. Legibility gives
    // way to reachability: a card you can tap beats a card you cannot.
    return Math.max(1, Math.min(width, available));
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
      fan: isNarrow(),
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
    if (existing) {
      // The same card can change rows — a swap puts a hand card in the market —
      // so the handler is re-pointed every layout, not fixed at construction.
      existing.setOnTap(onTap);
      return existing;
    }
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
    const step = Math.min(cardWidth + GAP, Math.max(FAN_MIN_STEP, spread));
    // Never wider than the spread the row can actually hold: clamping up to the
    // legibility floor is what used to push the last card off the edge.
    return Math.max(1, Math.min(step, Math.max(1, spread)));
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
    // they reappeared as ghosts at the foot of the table. Their tweens go too,
    // or a pulse keeps writing to a destroyed Text.
    for (const child of this.areaLayer.removeChildren()) {
      killTweens(child);
      child.destroy();
    }
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
        y = this.layoutChips(player.playArea, y, isMe);
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

  private layoutChips(cards: readonly Card[], startY: number, _own: boolean): number {
    const contentLeft = PAD + GROUP_LABEL_WIDTH + 6;
    const available = this.width - PAD - contentLeft;
    const cellWidth = Math.floor((available - (SLOT_COUNT - 1) * SLOT_GAP) / SLOT_COUNT);

    let y = startY;

    const cell = (index: number, tint: number, slot: SlotCell): void => {
      const column = index % SLOT_COUNT;
      if (column === 0 && index > 0) y += SLOT_ROW;
      const x = contentLeft + column * (cellWidth + SLOT_GAP);

      // Owned takes the container's colour; a slot a wildcard is standing in
      // for is starred, since no card of that operation is actually held; a
      // slot still missing stays grey. The gaps are the point — they are what
      // says who is going for what.
      const owned = slot.state === 'owned';
      const covered = slot.state === 'covered';
      const colour = owned || covered ? tint : EMPTY_SLOT;

      const box = new Graphics()
        .roundRect(x, y, cellWidth, 22, 3)
        .fill({ color: owned || covered ? tint : 0x000000, alpha: owned ? 0.16 : covered ? 0.05 : 0.14 })
        .stroke({ width: 1, color: colour, alpha: owned ? 1 : covered ? 0.8 : 0.4 });

      const text = body(covered ? `✦${slot.text}` : slot.text, 11, colour);
      text.alpha = owned ? 1 : covered ? 0.9 : 0.55;
      const room = cellWidth - 6;
      if (text.width > room) text.scale.set(Math.max(0.6, room / text.width));
      text.position.set(x + Math.round((cellWidth - text.width * text.scale.x) / 2), y + 4);

      this.areaLayer.addChild(box, text);
    };

    const row = (label: string, tint: number, slots: readonly SlotCell[]): void => {
      const heading = body(label, 12, tint);
      heading.position.set(PAD, y + 4);
      this.areaLayer.addChild(heading);
      slots.forEach((slot, index) => cell(index, tint, slot));
      y += SLOT_ROW;
    };

    // Every player gets every container, so the grids line up and a glance down
    // a column compares four hands at the same slot.
    for (const container of containers) {
      const slots = CONTAINER_SLOTS[container] ?? [];
      const counts = new Map<string, number>();
      for (const card of cards) {
        if (card.kind === 'container-function' && card.container === container) {
          counts.set(card.operation, (counts.get(card.operation) ?? 0) + 1);
        }
      }
      const covered = coveredOperations(cards, container, slots);

      row(
        containerMeta[container]?.symbol ?? container,
        toHexNumber(containerColor[container]),
        slots.map((operation) => {
          const count = counts.get(operation) ?? 0;
          if (count > 0) {
            return { text: count > 1 ? `${operation}×${count}` : operation, state: 'owned' as const };
          }
          return { text: operation, state: covered.has(operation) ? 'covered' as const : 'empty' as const };
        }),
      );
    }

    // Wildcards and utilities have no fixed set — a player holds whichever they
    // drafted — so these rows appear only when there is something in them.
    for (const [key, label] of [['joker', '✦'], ['utility', 'λ']] as const) {
      const held = new Map<string, number>();
      for (const card of cards) {
        const isJoker = card.kind === 'wildcard' || card.kind === 'operation-wildcard'
          || card.kind === 'container-wildcard';
        if (key === 'joker' ? !isJoker : card.kind !== 'utility') continue;
        const text = card.kind === 'utility' ? card.operation : card.label;
        held.set(text, (held.get(text) ?? 0) + 1);
      }
      if (held.size === 0) continue;

      row(
        label,
        toHexNumber(key === 'utility' ? utilityColor : wildcardColor),
        [...held].sort((a, b) => a[0].localeCompare(b[0])).map(([text, count]) => ({
          text: count > 1 ? `${text}×${count}` : text,
          state: 'owned' as const,
        })),
      );
    }

    return y;
  }
}
