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
import { dealIn, flip, killTweens, moveTo, pulse } from './motion.ts';
import type { Point } from './motion.ts';
import type { TableTextures } from './assets.ts';
import { containerMeta, statusName } from '../theme/meta.ts';
import { containerColor, palette, toHexNumber, utilityColor, wildcardColor } from '../theme/tokens.ts';
import { containers, createDeck, utilities } from '../../../src/core/cards.ts';
import { comboDefinitions, coveredOperations, scoringCombos } from '../../../src/core/combos.ts';
import { scorePlayer } from '../../../src/core/scoring.ts';
import { isNarrow } from '../ui/viewport.ts';
import type { Card, ContainerName, PublicPlayer, PublicState, Reveal } from '../../../src/core/types.ts';

const GAP = 12;
const PAD = 16;
/** Cells stop growing past this; a stretched badge is not more readable. */
const SLOT_MAX_WIDTH = 104;
/** And stop shrinking here, where the longest operation still reads. */
const SLOT_MIN_WIDTH = 72;
/** The card row stops spreading here; five cards strung across 1900px read as
    five unrelated cards rather than one row to choose from. */
const CARD_ROW_MAX_WIDTH = 760;

const SLOT_GAP = 4;
const SLOT_ROW = 26;
/** Just the container's sigil: the row's position and colour say the rest. */
const GROUP_LABEL_WIDTH = 30;

/** Below this the play area stacks its two regions instead of splitting them. */
const AREA_SPLIT_WIDTH = 620;
const TYPECLASS_COLUMNS = 2;
const TYPECLASS_MAX_WIDTH = 150;
const TYPECLASS_MIN_WIDTH = 118;


/** A full hand. Cards shrink a little to keep it on one row when they nearly fit. */
const HAND_SIZE = 5;
/** Narrowest a fanned card's visible strip may get and still show its emblem. */
const FAN_MIN_STEP = 40;
const ROW_LABEL = 22;
/** Widest the gap between the drawn card and the market gets. */
const MARKET_GAP = 32;
/** How much of a market card the next one covers, when there is room to choose.
    The market is a stack to pick from, so it reads as one group; the drawn card
    stands alone. */
const MARKET_OVERLAP = 0.52;
/** Narrowest a market card's visible strip may get and still be tappable. */
const MARKET_MIN_STEP = 30;
/** Number keys for the top row, in the order the cards are drawn. */
const KEY_HINTS = ['1', '2', '3', '4', '5'];
/** How far a chosen card lifts clear of the ones it overlaps. */
const FAN_LIFT = 16;
/** The guide answers one question, so it stays short enough to read at a glance. */
const GUIDE_MAX_ROWS = 6;
const GUIDE_COLUMNS = 2;
const GUIDE_MAX_WIDTH = 220;
/** Narrowest a guide block may be. Two of them fit side by side, or they stack. */
const GUIDE_MIN_WIDTH = 236;

/** Narrowest the card column may be and still show two cards whole with three
    tappable strips between them. Below this the columns stack instead. */
const CARD_COLUMN_MIN_WIDTH = MIN_CARD_WIDTH * 2 + MARKET_GAP + 3 * MARKET_MIN_STEP;
/** What the card row wants: two cards whole and three at the design overlap. */
const CARD_COLUMN_WIDTH =
  CARD_WIDTH * 2 + MARKET_GAP + 3 * Math.round(CARD_WIDTH * MARKET_OVERLAP);

const LINE = toHexNumber(palette.line);
const MUTED = toHexNumber(palette.muted);
const TEXT = toHexNumber(palette.text);
const ACCENT = toHexNumber(palette.accent);
const EMPTY_SLOT = toHexNumber(palette.muted);
/** Text on an inverted cell. Selection is shown by filling, not by hue: every
    hue in the palette already means a container, a utility or a joker. */
const INK = toHexNumber(palette.bg);

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

/* A container's whole slot set goes on one line, so every play area is the
   same shape and they can be compared down the column. Counted from the deck
   rather than written down: giving List a `zero` card would otherwise wrap its
   row and break the one-row-per-container rule the comparison rests on. */
const SLOT_COUNT = Math.max(
  ...containers.map((container) => CONTAINER_SLOTS[container]?.length ?? 0),
);

/* What each region of a play area actually draws, rather than what it is
   handed. Sizing from the content is what keeps the two regions adjacent: a
   share of the width left a quarter of the screen of dead felt between them. */
const CARDS_REGION_WIDTH =
  GROUP_LABEL_WIDTH + 6 + SLOT_COUNT * SLOT_MAX_WIDTH + (SLOT_COUNT - 1) * SLOT_GAP;
const TYPECLASS_REGION_WIDTH =
  TYPECLASS_COLUMNS * TYPECLASS_MAX_WIDTH + (TYPECLASS_COLUMNS - 1) * SLOT_GAP;
const AREA_COLUMN_GAP = GAP * 2;
const PLAY_AREA_WIDTH = CARDS_REGION_WIDTH + AREA_COLUMN_GAP + TYPECLASS_REGION_WIDTH;
/* And the least it can be given and still read. Splitting on the width the
   play area *wants* starved the card column down to 25px strips on a 1440
   screen: the cells cap at their maximum but do not need it. */
const PLAY_AREA_MIN_WIDTH =
  GROUP_LABEL_WIDTH + 6 + SLOT_COUNT * SLOT_MIN_WIDTH + (SLOT_COUNT - 1) * SLOT_GAP
  + AREA_COLUMN_GAP
  + TYPECLASS_COLUMNS * TYPECLASS_MIN_WIDTH + (TYPECLASS_COLUMNS - 1) * SLOT_GAP;

/** One cell of a container's row: an operation this player does or does not have. */
interface SlotCell {
  readonly text: string;
  readonly state: 'owned' | 'covered' | 'empty';
  /** Held more than once. Worth a mark, not a word: a second copy of the same
   *  operation adds nothing to a combo. */
  readonly duplicate?: boolean;
}

/** A card the guide is speaking about, and where it came from. */
interface GuideFocus {
  readonly role: string;
  readonly card: Card;
}

/** One card in the top row, with the rule that governs it. */
interface RowCard {
  readonly card: Card;
  readonly onTap: (card: Card) => void;
  readonly enabled: boolean;
  /** Extra space before this card, to separate it from the ones before it. */
  readonly gapBefore?: number;
  /** How far the next card sits from this one. Less than a card width overlaps. */
  readonly advance?: number;
}

export interface TableInput {
  readonly state: PublicState;
  readonly selectedCardId: string | null;
  readonly selectedMarketId: string | null;
  /** Raised for a look, not yet chosen. Narrow screens only. */
  readonly previewCardId: string | null;
  readonly previewMarketId: string | null;
  /** Study mode: the top row shows each card's type instead of its face. */
  readonly showSignatures: boolean;
  /** Draw the other players' boards as well as mine. */
  readonly showOpponents: boolean;
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
  /** The drawn card and the market, in one row. */
  private readonly cardRowLayer = new Container();
  private readonly areaLayer = new Container();
  /** Sits under the card row: what the card being considered would change. */
  private readonly guideLayer = new Container();
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
  /** Card geometry the cached sprites were built at. */
  private geometryKey = '';
  /** Visible height of the canvas, and how tall the laid-out table is. */
  private viewportHeight = 0;
  private contentHeight = 0;
  private scrollY = 0;
  /** Asks the host whether the pointer has been dragged, so a scroll is not a tap. */
  private wasDragged: () => boolean = () => false;

  /**
   * The typeclass a player tapped, or null. Selecting one marks the operations
   * it needs across every card row, which is how the ladder from Apply to Monad
   * becomes visible on the table instead of only in a reference sheet.
   */
  private selectedCombo: string | null = null;

  /** The last input drawn, so a toggle can repaint without the store. */
  private lastInput: TableInput | null = null;

  /**
   * The key numerals drawn over the top row. Held so they can be destroyed:
   * the row detaches its children rather than destroying them, because the
   * card sprites in it are reused — but these are rebuilt every layout, and
   * detaching alone leaked five Text objects per update.
   */
  private readonly keyHints: Text[] = [];

  constructor(app: Application, textures: TableTextures, callbacks: TableCallbacks, width: number) {
    this.textures = textures;
    this.callbacks = callbacks;
    this.width = width;
    this.background = textures.tile
      ? new TilingSprite({ texture: textures.tile, width, height: 1 })
      : new Graphics();
    this.root.addChild(this.background, this.cardRowLayer, this.guideLayer, this.areaLayer);
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
  /**
   * Scrolls the table. Returns whether it actually moved, so a wheel event over
   * a table with nothing left to show can fall through to the page.
   */
  scrollBy(delta: number): boolean {
    const before = this.scrollY;
    this.scrollY += delta;
    this.clampScroll();
    return this.scrollY !== before;
  }

  /** How much of the table is below the fold. Zero when it all fits. */
  hiddenBelow(): number {
    return Math.max(0, this.contentHeight - this.viewportHeight - this.scrollY);
  }

  /** Returns to the hand, which is where a cancelled pick starts again. */
  scrollToTop(): void {
    this.scrollY = 0;
    this.clampScroll();
  }

  /** Brings the market row to the top of the visible area. */
  private clampScroll(): void {
    const overflow = Math.max(0, this.contentHeight - this.viewportHeight);
    this.scrollY = Math.max(0, Math.min(overflow, this.scrollY));
    this.root.y = -this.scrollY;
  }

  /** Where the market row starts, in canvas pixels. */

  /**
   * Card width for the current table width. A hand of five wraps to a stranded
   * second row at full size on a desktop column, so cards give up a few pixels
   * to stay on one line — but never below the width their text needs.
   */
  /**
   * The one row of cards, measured as a whole.
   *
   * Two cards are shown whole — the drawn one and the last of the market — with
   * the market's others overlapping between them and a gap separating the two
   * groups. Sizing the cards without that shape in mind is what pushed the
   * market off the right edge of a phone: the row was measured as five cards
   * fanned evenly, which is not what it draws.
   */
  private cardRowMetrics(regionWidth: number = this.width - PAD * 2): {
    cardWidth: number; gap: number; step: number;
  } {
    const available = Math.max(1, regionWidth);
    const gap = Math.max(12, Math.min(MARKET_GAP, Math.round(available * 0.06)));
    // Market cards that overlap rather than being shown whole.
    const strips = Math.max(0, HAND_SIZE - 2);

    const fitsRow = (available - gap - strips * MARKET_MIN_STEP) / 2;
    const cardWidth = Math.max(
      1,
      Math.min(available, Math.max(MIN_CARD_WIDTH, Math.min(CARD_WIDTH, Math.floor(fitsRow)))),
    );

    // Whatever is left over is shared between the strips, up to the overlap the
    // design asks for. A card you can tap beats a card you cannot, so the strip
    // is allowed below its floor rather than letting the row run off the edge.
    const room = available - gap - cardWidth * 2;
    const step = strips > 0
      ? Math.max(1, Math.min(Math.round(cardWidth * MARKET_OVERLAP), Math.floor(room / strips)))
      : cardWidth;

    return { cardWidth, gap, step };
  }

  private cardWidth(regionWidth: number = this.width - PAD * 2): number {
    return this.cardRowMetrics(regionWidth).cardWidth;
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) killTweens(sprite);
    this.effects.destroy();
    this.root.destroy({ children: true });
    this.sprites.clear();
    this.lastSeen.clear();
    this.rowLabels.clear();
    // Already destroyed with the tree; emptied so a stale scene cannot be
    // asked to destroy them a second time.
    this.keyHints.length = 0;
  }

  /** Rebuilds layout from state, reusing every sprite whose card is still on the table. */
  update(input: TableInput): number {
    this.lastInput = input;
    const {
      state, selectedCardId, selectedMarketId, previewCardId, previewMarketId,
      showSignatures, showOpponents,
    } = input;
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

    // Two columns when both fit: the cards and, under them, the guide for
    // whatever is being chosen; the play areas beside them, spanning both.
    // The play area is the column that cannot shrink much, so it is served
    // first and the card column takes what is left, down to its own floor.
    const fullWidth = this.width - PAD * 2;
    const split = fullWidth >= CARD_COLUMN_MIN_WIDTH + GAP * 2 + PLAY_AREA_MIN_WIDTH;
    const cardsWidth = split
      ? Math.max(
          CARD_COLUMN_MIN_WIDTH,
          Math.min(CARD_COLUMN_WIDTH, fullWidth - PLAY_AREA_MIN_WIDTH - GAP * 2),
        )
      : Math.min(fullWidth, CARD_ROW_MAX_WIDTH);
    const areasLeft = split ? PAD + cardsWidth + GAP * 2 : PAD;
    const areasWidth = split ? this.width - areasLeft - PAD : fullWidth;

    let y = PAD;

    // The drawn card and the four market cards are one row: five cards, always,
    // so there is nothing for a second row to hold.
    // Card size stays fixed for the row whatever it holds, so a card does not
    // resize as it moves between the draw and the market. Only the overlap
    // adapts: with no drawn card the market has the whole row to spread into.
    // Overlapping is fine for choosing — a strip of each card is enough to
    // tell them apart. It is not fine for reading, and the back of a card is
    // nothing but reading, so study mode lays them out in full and wraps.
    const studying = showSignatures;
    const row = this.cardRowMetrics(cardsWidth);
    const gap = state.drawn && !studying ? row.gap : 0;
    const strips = Math.max(0, state.market.length - 1);
    const room = cardsWidth - gap - row.cardWidth * (state.drawn ? 2 : 1);
    const step = strips > 0
      ? Math.max(1, Math.min(Math.round(row.cardWidth * MARKET_OVERLAP), Math.floor(room / strips)))
      : row.cardWidth;

    const rowCards: RowCard[] = [
      ...(state.drawn
        ? [{
            card: state.drawn,
            onTap: this.callbacks.onSelectHand,
            enabled: myTurn,
            ...(studying ? {} : { advance: row.cardWidth }),
          }]
        : []),
      // Market cards are inert until the drawn card is chosen — the two steps.
      ...state.market.map((card, index) => ({
        card,
        onTap: this.callbacks.onSelectMarket,
        enabled: myTurn && Boolean(selectedCardId),
        // The row is one row, but the drawn card is mine and the market is
        // everyone's; a gap says which is which without a second label.
        gapBefore: index === 0 && state.drawn ? gap : 0,
        ...(studying ? {} : { advance: step }),
      })),
    ];

    y = this.layoutRow({
      layer: this.cardRowLayer,
      title: state.me?.isMyTurn ? '내 차례 · 뽑은 카드와 시장' : '뽑은 카드와 시장',
      left: PAD,
      width: cardsWidth,
      cards: rowCards,
      y,
      seen,
      faceDown: studying,
      // A shortcut nobody can see is a shortcut nobody uses, and the numbers
      // are only true while the row is the player's to act on.
      keyHints: myTurn,
      selectedIds: new Set([selectedCardId, selectedMarketId].filter((id): id is string => Boolean(id))),
      raisedIds: new Set([previewCardId, previewMarketId].filter((id): id is string => Boolean(id))),
      // Five cards rarely fit side by side, so they overlap and spread to fill —
      // except while their backs are showing, when every one has to be legible.
      fan: !studying,
    });

    // What the player is looking at right now. A preview counts — on a phone the
    // first tap only reads a card, and that is exactly when the guide is wanted.
    // Both sides show at once during a swap: that choice is a comparison, and
    // one guide cannot answer it.
    const find = (id: string | null): Card | null =>
      (id ? rowCards.find((entry) => entry.card.id === id)?.card ?? null : null);
    const focus: GuideFocus[] = [
      { role: '뽑은 카드', card: find(previewCardId ?? selectedCardId) },
      { role: '시장', card: find(previewMarketId ?? selectedMarketId) },
    ].filter((entry): entry is GuideFocus => entry.card !== null);
    y = this.layoutSelectionGuide(state, focus, y + GAP, PAD, cardsWidth);

    const areasEnd = this.layoutPlayAreas(state, split ? PAD : y + GAP, areasLeft, areasWidth, showOpponents);
    y = split ? Math.max(y, areasEnd) : areasEnd;

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
  private fanStep(count: number, cardWidth: number, regionWidth: number): number {
    if (count < 2) return cardWidth + GAP;
    // Spread to fill the row: the fan is as open as the width allows, and only
    // overlaps as much as it must.
    const spread = Math.floor((regionWidth - cardWidth) / (count - 1));
    const step = Math.min(cardWidth + GAP, Math.max(FAN_MIN_STEP, spread));
    // Never wider than the spread the row can actually hold: clamping up to the
    // legibility floor is what used to push the last card off the edge.
    return Math.max(1, Math.min(step, Math.max(1, spread)));
  }

  private layoutRow(options: {
    layer: Container;
    title: string;
    left: number;
    width: number;
    /**
     * Each card carries its own handler and enabled state: the drawn card and
     * the market share this row but not their rules, and the count is fixed at
     * five, so one row holds them both.
     */
    cards: readonly RowCard[];
    y: number;
    seen: Set<string>;
    selectedIds: ReadonlySet<string>;
    /** Show every card in this row as its type rather than its face. */
    faceDown?: boolean;
    /** Number the cards, matching the keys that select them. */
    keyHints?: boolean;
    /** Lifted above its neighbours to be read, without being chosen. */
    raisedIds?: ReadonlySet<string>;
    /** Overlap the cards like a held hand instead of laying them out in a grid. */
    fan?: boolean;
  }): number {
    const {
      layer, title, left, width, cards, y, seen, selectedIds,
      raisedIds = new Set<string>(), fan = false, faceDown = false, keyHints = false,
    } = options;
    // Detach only: the card sprites in here are reused and must not be
    // destroyed. The hints are not reused, so they are destroyed by hand.
    layer.removeChildren();
    for (const hint of this.keyHints.splice(0)) hint.destroy();

    let label = this.rowLabels.get(layer);
    if (!label) {
      label = heading(title);
      this.rowLabels.set(layer, label);
    }
    label.position.set(left, y);
    layer.addChild(label);

    // Room for the lift above the cards as well as below: a raised card used to
    // rise over the row's own heading and cover it.
    const top = y + ROW_LABEL + (fan ? FAN_LIFT : 0);
    const cardHeight = metricsFor(width).height;
    const cardWidth = this.cardWidth(width);
    // Each card says how far the next one sits, so one row can hold a card that
    // stands alone and a group that overlaps. Anything that does not say falls
    // back to the fan, which spreads to fill whatever room is left.
    const extraGaps = cards.reduce((sum, entry) => sum + (entry.gapBefore ?? 0), 0);
    const step = fan
      ? this.fanStep(cards.length, cardWidth, width - extraGaps)
      : cardWidth + GAP;

    const positions: number[] = [];
    let cursor = 0;
    for (const entry of cards) {
      cursor += entry.gapBefore ?? 0;
      positions.push(cursor);
      cursor += entry.advance ?? step;
    }
    const perRow = fan
      ? cards.length || 1
      : Math.max(1, Math.floor((width + GAP) / (cardWidth + GAP)));

    cards.forEach(({ card, onTap, enabled }, index) => {
      const existed = this.sprites.has(card.id);
      const sprite = this.spriteFor(card, onTap);
      seen.add(card.id);
      sprite.setSelected(selectedIds.has(card.id));
      sprite.setEnabled(enabled);
      // A card already in place turns over; one arriving this frame is simply
      // dealt showing the requested side, with no flip to see.
      if (existed) {
        if (sprite.isFaceDown() !== faceDown) flip(sprite, () => sprite.setFaceDown(faceDown));
      } else {
        sprite.setFaceDown(faceDown);
      }

      // Previewed and chosen cards both come forward; only the chosen one is
      // outlined, so a look is never mistaken for a decision.
      const raised = sprite.isSelected() || raisedIds.has(card.id);

      const column = index % perRow;
      const row = Math.floor(index / perRow);
      // A wrapped grid still steps by column; a single row uses the walk above.
      const offset = row === 0 ? positions[index]! : column * step;
      // A raised card lifts clear of its neighbours — further when fanned,
      // where the lift is what separates it from the cards it overlaps.
      const lift = raised ? (fan ? FAN_LIFT : 5) : 0;
      const target: Point = {
        x: left + offset,
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
        // Each card stays tappable across the strip its neighbour leaves free,
        // so an overlapped card can still be reached at its own left edge.
        const next = positions[index + 1];
        const strip = next === undefined ? cardWidth : Math.min(cardWidth, next - positions[index]!);
        sprite.hitArea = new Rectangle(0, 0, Math.max(1, strip), cardHeight);
      }

      if (!existed) {
        sprite.position.set(target.x, target.y);
        dealIn(sprite, index);
      } else if (sprite.x !== target.x || sprite.y !== target.y) {
        // Reused sprite: tween from where it already is rather than jumping.
        moveTo(sprite, target);
      }
      this.lastSeen.set(card.id, { ...target });

      if (keyHints && index < KEY_HINTS.length) {
        const hint = body(KEY_HINTS[index]!, 10, TEXT);
        // Bottom-left: the card's own colour, glyph and name all live along the
        // top and left edges, and a fanned card is covered from the right, so
        // this corner is the part of every card that stays visible.
        hint.position.set(target.x + 8, target.y + cardHeight - 18);
        // Above every card in the row. The fan sorts by zIndex, and a hint left
        // at the default sat under the card overlapping its own.
        hint.zIndex = cards.length + 2;
        hint.alpha = 0.75;
        this.keyHints.push(hint);
        layer.addChild(hint);
      }
    });

    if (fan) layer.sortableChildren = true;

    const rows = Math.max(1, Math.ceil(cards.length / perRow));
    return top + rows * (cardHeight + GAP);
  }

  private layoutPlayAreas(
    state: PublicState,
    startY: number,
    left: number,
    width: number,
    showOpponents: boolean,
  ): number {
    // Chips and their labels are rebuilt every update, so the old ones are
    // destroyed rather than just detached — detaching alone left them alive and
    // they reappeared as ghosts at the foot of the table. Their tweens go too,
    // or a pulse keeps writing to a destroyed Text.
    for (const child of this.areaLayer.removeChildren()) {
      killTweens(child);
      child.destroy();
    }
    let y = startY;
    const narrow = width < AREA_SPLIT_WIDTH;
    const me = state.players.find((player) => player.id === state.me?.id) ?? null;
    const others = state.players.filter((player) => player.id !== me?.id);

    // Narrow screens put my typeclasses above everything: what I am building
    // towards outranks a record of what four seats have already played.
    if (narrow && me) {
      const label = heading('타입클래스');
      label.position.set(left, y);
      this.areaLayer.addChild(label);
      y = this.layoutTypeclasses(me, y + ROW_LABEL, left, width) + GAP;
    }

    // Four boards are taller than any window, so only mine is drawn until the
    // others are asked for. Hiding them is what makes the rest reachable; a
    // scrollbar only made the problem findable. An observer has no board of
    // their own, so there is nothing to hide the others in favour of.
    const hiding = Boolean(me) && !showOpponents;
    const label = heading(hiding ? `플레이 영역 · 내 것만 (상대 ${others.length}명 숨김)` : '플레이 영역');
    label.position.set(left, y);
    this.areaLayer.addChild(label);
    y += ROW_LABEL;

    // Mine first, always: it is the one board being played, and the one whose
    // bottom row must never be the thing that falls off the screen.
    const order = me ? (hiding ? [me] : [me, ...others]) : state.players;

    for (const player of order) {
      const isMe = player.id === state.me?.id;
      const isCurrent = state.currentPlayerId === player.id;

      const name = body(
        `${player.name}${player.bot ? ' (Bot)' : ''} · ${statusName(player.status)} · ${player.publicScore.total}점`,
        13,
        isCurrent ? ACCENT : isMe ? TEXT : MUTED,
      );
      name.position.set(left, y);
      this.areaLayer.addChild(name);
      if (isCurrent && state.currentPlayerId !== this.lastCurrentPlayerId) pulse(name);
      y += 20;

      // Where a card flying to this player should land.
      this.seatAnchor.set(player.id, { x: left + 40, y: y + 12 });

      // Cards and typeclasses are two regions, never one. Claiming Apply does
      // not spend the map card, so nothing a player holds may vanish from the
      // card region when a combo forms beside it.
      if (narrow) {
        const cardsEnd = this.layoutChips(player, y, left, width);
        // Mine are already at the top of the screen; everyone else carries
        // their own beneath their cards.
        y = isMe ? cardsEnd : this.layoutTypeclasses(player, cardsEnd, left, width);
      } else {
        const cardsWidth = Math.min(CARDS_REGION_WIDTH, width - TYPECLASS_REGION_WIDTH - AREA_COLUMN_GAP);
        const typeclassWidth = Math.min(TYPECLASS_REGION_WIDTH, width - cardsWidth - AREA_COLUMN_GAP);
        y = Math.max(
          this.layoutChips(player, y, left, cardsWidth),
          this.layoutTypeclasses(player, y, left + cardsWidth + AREA_COLUMN_GAP, typeclassWidth),
        );
      }
      y += GAP;
    }
    this.lastCurrentPlayerId = state.currentPlayerId;
    return y;
  }

  /**
   * Every typeclass in the game, and how far this player has got with each.
   *
   * The whole ladder is listed rather than only what has been achieved: the
   * point of the game is to learn that Apply comes before Applicative comes
   * before Monad, and a list that only appears once you have already built
   * something teaches nobody anything. Unreached ones are dimmed, exactly as
   * an empty card slot is.
   *
   * Tapping one toggles it. While it is on, the operations it asks for are
   * marked in every card row, so `Monad` lights up map, ap, pure and chain
   * wherever they sit.
   */
  private layoutTypeclasses(player: PublicPlayer, startY: number, left: number, width: number): number {
    const claims = new Set(player.claimGroups.flat());
    const built = scoringCombos(player.playArea);
    const columns = TYPECLASS_COLUMNS;
    const cellWidth = Math.min(
      TYPECLASS_MAX_WIDTH,
      Math.floor((width - (columns - 1) * SLOT_GAP) / columns),
    );

    let y = startY;

    comboDefinitions.forEach((definition, index) => {
      // How many containers this player reached it in: `Monad x2` is Monad in
      // two containers, which is worth saying because each scores separately.
      const reached = definition.containers.filter((container) =>
        claims.has(`${container}:${definition.name}`)
        || built.some((combo) => combo.container === container && combo.name === definition.name),
      );
      const has = reached.length > 0;
      const selected = this.selectedCombo === definition.name;

      const column = index % columns;
      if (column === 0 && index > 0) y += SLOT_ROW;
      const x = left + column * (cellWidth + SLOT_GAP);

      // Selected chips invert too, for the same reason the cells they mark do.
      const colour = selected ? INK : has ? TEXT : EMPTY_SLOT;
      const box = new Graphics()
        .roundRect(x, y, cellWidth, 22, 3)
        .fill({ color: selected || has ? TEXT : 0x000000, alpha: selected ? 1 : has ? 0.12 : 0.14 })
        .stroke({ width: 1, color: selected ? TEXT : colour, alpha: has || selected ? 1 : 0.55 });

      const label = reached.length > 1 ? `${definition.name} x${reached.length}` : definition.name;
      const text = body(label, 11, colour);
      text.alpha = has || selected ? 1 : 0.9;
      const room = cellWidth - 8;
      if (text.width > room) text.scale.set(Math.max(0.6, room / text.width));
      text.position.set(x + Math.round((cellWidth - text.width * text.scale.x) / 2), y + 4);

      box.eventMode = 'static';
      box.cursor = 'pointer';
      box.hitArea = new Rectangle(x, y, cellWidth, 22);
      box.on('pointertap', () => {
        // A drag that ends over a chip is a scroll, not a choice.
        if (this.wasDragged()) return;
        this.selectedCombo = selected ? null : definition.name;
        this.redraw();
      });

      this.areaLayer.addChild(box, text);
    });

    return y + SLOT_ROW;
  }

  /**
   * What the card being considered would do for the typeclasses it touches.
   *
   * The play area says where a player stands; this says what one more card
   * would change, which is the question actually being asked at the moment of
   * choosing. Wildcards are the interesting case: a `*.*` reaches everything,
   * so the list is derived from what the card can stand in for rather than from
   * its printed container.
   */
  private layoutSelectionGuide(
    state: PublicState,
    focus: readonly GuideFocus[],
    startY: number,
    left: number,
    width: number,
  ): number {
    for (const child of this.guideLayer.removeChildren()) {
      killTweens(child);
      child.destroy();
    }
    if (focus.length === 0) return startY;

    const title = heading('이 카드를 가지면');
    title.position.set(left, startY);
    this.guideLayer.addChild(title);
    const top = startY + ROW_LABEL;

    // Two cards are a comparison, so they go side by side wherever they fit.
    if (focus.length > 1 && width >= GUIDE_MIN_WIDTH * 2 + GAP) {
      const columnWidth = Math.floor((width - GAP) / 2);
      return focus.reduce(
        (bottom, entry, index) => Math.max(
          bottom,
          this.layoutGuideBlock(state, entry, top, left + index * (columnWidth + GAP), columnWidth),
        ),
        top,
      );
    }

    return focus.reduce(
      (y, entry) => this.layoutGuideBlock(state, entry, y, left, width) + GAP,
      top,
    );
  }

  /** One card's worth of guide: what it moves, and how far. */
  private layoutGuideBlock(
    state: PublicState,
    { role, card }: GuideFocus,
    startY: number,
    left: number,
    width: number,
  ): number {
    const mine = state.players.find((player) => player.id === state.me?.id)?.playArea ?? [];
    let y = startY;

    const name = body(`${role} · ${card.label}`, 12, TEXT);
    name.position.set(left, y);
    this.guideLayer.addChild(name);
    y += 18;

    // A utility scores on variety alone, so no typeclass has anything to say.
    if (card.kind === 'utility') {
      const held = new Set(mine.filter((c) => c.kind === 'utility').map((c) => c.operation));
      const line = body(
        held.has(card.operation)
          ? `이미 가진 종류입니다. 유틸리티는 서로 다른 종류 수로만 점수가 됩니다 (현재 ${held.size}종).`
          : `유틸리티 ${held.size}종 → ${held.size + 1}종. 종류 수가 늘어야 점수가 오릅니다.`,
        12,
        MUTED,
      );
      line.position.set(left, y);
      this.guideLayer.addChild(line);
      return y + SLOT_ROW;
    }

    const after = [...mine, card];
    // Only the highest base tier in a container scores, so finishing Functor
    // when Apply is already built is worth nothing. What actually scores after
    // taking this card is the only honest answer to "what does this get me".
    const scoringAfter = new Set(scoringCombos(after).map((combo) => `${combo.container}:${combo.name}`));
    // A claim is gone once anyone has declared it, so the point is off the table.
    const taken = new Set(state.players.flatMap((player) => player.claimGroups.flat()));

    const rows = comboDefinitions
      .flatMap((definition) =>
        definition.containers.map((container) => {
          const before = coveredOperations(mine, container, definition.requires).size;
          const now = coveredOperations(after, container, definition.requires).size;
          const key = `${container}:${definition.name}`;
          return {
            definition,
            container,
            before,
            now,
            gained: now > before,
            // Complete, but a higher tier in this container already outranks it.
            outranked: now === definition.requires.length && !scoringAfter.has(key),
            claimed: taken.has(key),
          };
        }),
      )
      // Only what this card actually moves. Everything else is already on the
      // board for the player to read.
      .filter((row) => row.gained)
      .sort((a, b) =>
        (a.definition.requires.length - a.now) - (b.definition.requires.length - b.now)
        || b.definition.score - a.definition.score,
      )
      .slice(0, GUIDE_MAX_ROWS);

    if (rows.length === 0) {
      const line = body('이 카드로는 새로 진전되는 조합이 없습니다.', 12, MUTED);
      line.position.set(left, y);
      this.guideLayer.addChild(line);
      return y + SLOT_ROW;
    }

    // One number for the card as a whole. Per-combo figures cannot be added up
    // — two tiers of the same container do not both pay — so the delta of the
    // actual score is the only total that is true.
    // No claims on either side, so the difference is exactly what the cards are
    // worth. What a claim would pay is a separate matter and depends on how
    // many finish together.
    const worth = (playArea: readonly Card[]): number => scorePlayer({ playArea: [...playArea], claimGroups: [] }).total;
    const delta = worth(after) - worth(mine);
    const summary = body(
      delta > 0 ? `이 카드로 공개 점수 +${delta}` : '이 카드로 늘어나는 점수는 없습니다',
      11,
      delta > 0 ? ACCENT : MUTED,
    );
    summary.position.set(left, y);
    this.guideLayer.addChild(summary);
    y += 18;

    // A narrow block runs one to a line rather than squeezing two.
    const columns = width >= GUIDE_MIN_WIDTH * 2 ? GUIDE_COLUMNS : 1;
    const cellWidth = Math.min(
      GUIDE_MAX_WIDTH,
      Math.floor((width - (columns - 1) * SLOT_GAP) / columns),
    );
    rows.forEach((row, index) => {
      const column = index % columns;
      if (column === 0 && index > 0) y += SLOT_ROW;
      const x = left + column * (cellWidth + SLOT_GAP);

      const remaining = row.definition.requires.length - row.now;
      const done = remaining === 0;
      // Completing something that earns nothing is not a win, and filling it in
      // like one would be a lie. It stays outlined and says why.
      const pays = done && !row.outranked;
      const tint = toHexNumber(containerColor[row.container]);
      const sigil = containerMeta[row.container]?.symbol ?? row.container;

      const box = new Graphics()
        .roundRect(x, y, cellWidth, 22, 3)
        .fill({ color: tint, alpha: pays ? 1 : 0.12 })
        .stroke({ width: 1, color: tint, alpha: row.outranked ? 0.5 : 1 });

      const label = !done
        ? `${sigil} ${row.definition.name} · ${remaining}개 남음`
        : row.outranked
          ? `${sigil} ${row.definition.name} 완성 · 점수 없음`
          : row.claimed
            ? `${sigil} ${row.definition.name} +${row.definition.score} · Claim 선점됨`
            : `${sigil} ${row.definition.name} 완성 +${row.definition.score}`;
      const text = body(label, 11, pays ? INK : tint);
      text.alpha = row.outranked ? 0.75 : 1;
      const room = cellWidth - 8;
      if (text.width > room) text.scale.set(Math.max(0.6, room / text.width));
      text.position.set(x + 4, y + 4);
      this.guideLayer.addChild(box, text);
    });

    return y + SLOT_ROW;
  }

  /** Repaints the last state, for changes the scene owns rather than the store. */
  private redraw(): void {
    if (this.lastInput) this.update(this.lastInput);
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

    // Claiming is automatic now, so there is no `claiming` status to watch for.
    // The event log says what the card actually earned, and the newest entry is
    // the one this reveal produced.
    const latest = state.events[0];
    if (latest?.type === 'claim' && latest.playerId === reveal.playerId) {
      this.effects.celebrate(destination, cardColor(reveal.card));
    }
  }

  /**
   * What a player holds, as one row of equal cells per container.
   *
   * Only cards live here. Combos moved out to their own region, because they
   * are not made of the same stuff: a combo name is several times longer than
   * an operation, so the two could never share a cell width, and folding a
   * combo's operations away made owned cards disappear the moment they started
   * paying off. The slots are fixed by the deck, so every player's rows line up
   * and the shape of what someone is missing can be read across the table.
   */
  private layoutChips(player: PublicPlayer, startY: number, left: number, width: number): number {
    const cards = player.playArea;
    const contentLeft = left + GROUP_LABEL_WIDTH + 6;
    const available = width - GROUP_LABEL_WIDTH - 6;

    // The operations the selected typeclass asks for, per container. Nothing is
    // marked when nothing is selected.
    const wanted = comboDefinitions.find((definition) => definition.name === this.selectedCombo);

    let y = startY;

    const gridRow = (
      label: string,
      tint: number,
      cells: readonly SlotCell[],
      columns: number,
      marked: ReadonlySet<string> = new Set(),
    ): void => {
      if (cells.length === 0) return;
      const cellWidth = Math.max(
        1,
        Math.min(SLOT_MAX_WIDTH, Math.floor((available - (columns - 1) * SLOT_GAP) / columns)),
      );

      if (label) {
        const heading = body(label, 12, tint);
        heading.position.set(left, y + 4);
        this.areaLayer.addChild(heading);
      }

      cells.forEach((slot, index) => {
        const column = index % columns;
        if (column === 0 && index > 0) y += SLOT_ROW;
        const x = contentLeft + column * (cellWidth + SLOT_GAP);

        // Held, filled by a wildcard, or still missing.
        const owned = slot.state === 'owned';
        const covered = slot.state === 'covered';
        // Asked for by the typeclass the player has selected. Marked cells fill
        // with their own row's colour and flip their text dark, so the mark
        // never has to borrow a hue that already means something else.
        const needed = marked.has(slot.text);
        const colour = needed ? INK : owned || covered ? tint : EMPTY_SLOT;

        const box = new Graphics()
          .roundRect(x, y, cellWidth, 22, 3)
          .fill({
            color: needed ? tint : owned || covered ? tint : 0x000000,
            alpha: needed ? 1 : owned ? 0.16 : covered ? 0.05 : 0.14,
          })
          .stroke({
            width: 1,
            color: needed ? tint : colour,
            alpha: needed || owned ? 1 : covered ? 0.8 : 0.55,
          });

        const text = body(slot.text, 11, colour);
        text.alpha = needed || owned ? 1 : 0.9;
        const room = cellWidth - 8;
        if (text.width > room) text.scale.set(Math.max(0.6, room / text.width));
        text.position.set(x + Math.round((cellWidth - text.width * text.scale.x) / 2), y + 4);
        this.areaLayer.addChild(box, text);

        if (slot.duplicate) {
          const dot = new Graphics().circle(x + cellWidth - 5, y + 5, 2).fill({ color: tint, alpha: 0.9 });
          this.areaLayer.addChild(dot);
        }
      });

      y += SLOT_ROW;
    };

    for (const container of containers) {
      const slots = CONTAINER_SLOTS[container] ?? [];
      const counts = new Map<string, number>();
      for (const card of cards) {
        if (card.kind === 'container-function' && card.container === container) {
          counts.set(card.operation, (counts.get(card.operation) ?? 0) + 1);
        }
      }
      const covered = coveredOperations(cards, container, slots);
      const sigil = containerMeta[container]?.symbol ?? container;
      const tint = toHexNumber(containerColor[container]);

      // A typeclass only marks the containers it can actually be built in, so
      // selecting Foldable lights up List and leaves Maybe alone.
      const marked = wanted?.containers.includes(container)
        ? new Set(wanted.requires)
        : new Set<string>();

      gridRow(
        sigil,
        tint,
        slots.map((operation) => {
          const count = counts.get(operation) ?? 0;
          if (count > 0) return { text: operation, state: 'owned' as const, duplicate: count > 1 };
          return { text: operation, state: covered.has(operation) ? 'covered' as const : 'empty' as const };
        }),
        SLOT_COUNT,
        marked,
      );
    }

    // Utilities score on how many different ones you hold, so the deck's twelve
    // get fixed slots like a container's operations do: what is missing is the
    // whole point, and an empty row said nothing about what could fill it.
    const utilityCounts = new Map<string, number>();
    for (const card of cards) {
      if (card.kind !== 'utility') continue;
      utilityCounts.set(card.operation, (utilityCounts.get(card.operation) ?? 0) + 1);
    }
    gridRow(
      'λ',
      toHexNumber(utilityColor),
      utilities.map((operation) => {
        const count = utilityCounts.get(operation) ?? 0;
        return count > 0
          ? { text: operation, state: 'owned' as const, duplicate: count > 1 }
          : { text: operation, state: 'empty' as const };
      }),
      SLOT_COUNT,
    );

    // Wildcards are the exception: a player holds whichever of the fourteen they
    // drafted, and fourteen mostly-empty cells would bury the rows that matter.
    const jokers = new Map<string, number>();
    for (const card of cards) {
      const isJoker = card.kind === 'wildcard' || card.kind === 'operation-wildcard'
        || card.kind === 'container-wildcard';
      if (!isJoker) continue;
      jokers.set(card.label, (jokers.get(card.label) ?? 0) + 1);
    }
    gridRow(
      '✦',
      toHexNumber(wildcardColor),
      [...jokers].sort((a, b) => a[0].localeCompare(b[0])).map(([text, count]) => ({
        text,
        state: 'owned' as const,
        duplicate: count > 1,
      })),
      SLOT_COUNT,
    );

    return y;
  }
}
