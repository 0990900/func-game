/**
 * Faithful port of the legacy rules core (`src/game/game.js`).
 *
 * These functions mutate a draft Room. The Effect layer in `commands.ts` owns
 * the cloning, so a thrown RuleError leaves the caller's room untouched —
 * the same failure-isolation the legacy State interpreter provided.
 *
 * Behavior is preserved deliberately, including known defects. Do not "fix"
 * rules here; corrections belong in a separate, tested change.
 */
import { createDeck } from './cards.ts';
import { scorePlayer } from './scoring.ts';
import { claimableCombos, comboKey, findCombos, isClaimable } from './combos.ts';
import { goals } from './goals.ts';
import { ruleError } from './errors.ts';
import { scoreUtilities } from './scoring.ts';
import type {
  Card,
  ContainerName,
  EventType,
  Goal,
  Player,
  Room,
} from './types.ts';

const MAX_PLAYERS = 4;
/** Cards each player ends the game with. */
export const CARDS_PER_PLAYER = 15;

/**
 * How long a seat has to act before the table moves on without it.
 *
 * A seat that never acts stalls everyone, and a disconnected player would hold
 * the game open until their reconnect window closed. On expiry the drawn card
 * is simply placed, which is the least destructive thing that can be decided
 * for someone: they keep the card and stay in the game.
 */
export const TURN_LIMIT_MS = 30_000;

export interface RuleDeps {
  readonly id: (prefix: string) => string;
  readonly random: () => number;
  /** Epoch milliseconds. Used only to stamp turn deadlines. */
  readonly now: () => number;
}

/** Starts the clock for whoever the table is now waiting on. */
function armTurnClock(deps: RuleDeps, room: Room): void {
  room.turnEndsAt = deps.now() + TURN_LIMIT_MS;
}

export function shuffle<A>(input: readonly A[], random: () => number): A[] {
  const result = [...input];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function createPlayer(deps: RuleDeps, name: string | null | undefined, bot = false): Player {
  return {
    id: deps.id(bot ? 'bot' : 'player'),
    name: name?.trim().slice(0, 24) || 'Player',
    bot,
    playArea: [],
    goalOptions: [],
    goal: null,
    claims: [],
    claimPoints: 0,
    connected: true,
  };
}

export function createRoom(deps: RuleDeps, hostName = 'Player'): Room {
  const host = createPlayer(deps, hostName, false);
  return {
    id: deps.id('room'),
    phase: 'lobby',
    direction: 'left',
    hostPlayerId: host.id,
    players: [host],
    deck: [],
    market: [],
    currentPlayerIndex: 0,
    drawn: null,
    reversePending: false,
    discard: [],
    lastReveal: [],
    claimedCombos: [],
    events: [],
    turnEndsAt: null,
    scoreLog: [],
  };
}

export function joinRoom(deps: RuleDeps, room: Room, name: string): Player {
  if (room.phase !== 'lobby') throw ruleError('이미 시작된 게임입니다.');
  if (room.players.length >= MAX_PLAYERS) throw ruleError('방이 가득 찼습니다.');
  const player = createPlayer(deps, name, false);
  room.players.push(player);
  addEvent(deps, room, 'join', `${player.name}님이 방에 참가했습니다.`, player.id);
  return player;
}

/**
 * Removes a player from the room before the game starts.
 *
 * Only in the lobby: seats, turn order and the deck are all fixed once a game
 * is under way, and pulling a chair out from under a running draft would leave
 * the turn pointing at nobody. The host cannot be removed — there would be no
 * one left who could start the game.
 */
export function kickPlayer(deps: RuleDeps, room: Room, playerId: string): void {
  if (room.phase !== 'lobby') throw ruleError('게임이 시작된 뒤에는 내보낼 수 없습니다.');
  if (playerId === room.hostPlayerId) throw ruleError('방장은 내보낼 수 없습니다.');
  const player = mustPlayer(room, playerId);

  room.players = room.players.filter((candidate) => candidate.id !== playerId);
  addEvent(deps, room, 'disconnect', `${player.name}님이 방에서 나갔습니다.`, playerId);
}

/**
 * Puts a new person in an existing seat, under their own name.
 *
 * Only for the host's chair in an empty lobby. Someone has to be able to start
 * the game, so the chair is reused rather than orphaned — but reusing it
 * without this handed the arriving player the previous host's name, and would
 * have handed them a score too had the game ever run.
 */
export function renamePlayer(deps: RuleDeps, room: Room, playerId: string, name: string): void {
  if (room.phase !== 'lobby') throw ruleError('게임이 시작된 뒤에는 이름을 바꿀 수 없습니다.');
  const player = mustPlayer(room, playerId);
  player.name = name?.trim().slice(0, 24) || 'Player';
  player.playArea = [];
  player.claims = [];
  player.claimPoints = 0;
  player.goal = null;
  player.goalOptions = [];
  addEvent(deps, room, 'join', `${player.name}님이 방장이 되었습니다.`, player.id);
}

export function addBotsToFour(deps: RuleDeps, room: Room): void {
  let i = 1;
  while (room.players.length < MAX_PLAYERS) room.players.push(createPlayer(deps, `Bot ${i++}`, true));
}

export function startGame(deps: RuleDeps, room: Room): void {
  if (room.phase !== 'lobby') throw ruleError('게임이 이미 시작되었습니다.');
  // The legacy core branched on `players.length < 2` with identical bodies;
  // collapsed here because the branch was provably behavior-free.
  addBotsToFour(deps, room);
  deal(deps, room);
}

/**
 * Plays again with the same people.
 *
 * Everything about the game is cleared and everything about the table is kept:
 * the seats, the names, who is a bot, and who is host. Leaving and remaking a
 * room would have meant every player re-entering a new code, which is a lot of
 * ceremony for "again".
 */
export function restartGame(deps: RuleDeps, room: Room): void {
  if (room.phase !== 'finished') throw ruleError('게임이 끝난 뒤에만 재시작할 수 있습니다.');

  for (const player of room.players) {
    player.playArea = [];
    player.claims = [];
    player.claimPoints = 0;
    player.goal = null;
    player.goalOptions = [];
  }
  room.claimedCombos = [];
  room.scoreLog = [];
  room.events = [];
  room.phase = 'lobby';
  deal(deps, room);
}

/** Shuffles, opens the market, and puts a pair of goals in front of everyone. */
function deal(deps: RuleDeps, room: Room): void {
  room.players = shuffle(room.players, deps.random);
  room.deck = shuffle(createDeck(), deps.random);
  room.market = room.deck.splice(0, 4);
  room.direction = 'left';
  room.phase = 'goal';
  room.lastReveal = [];
  room.currentPlayerIndex = 0;
  room.drawn = null;
  room.reversePending = false;
  room.discard = [];
  addEvent(deps, room, 'game_start', '게임을 시작합니다. 비밀 목표를 선택하세요.');
  addEvent(deps, room, 'turn_order', `자리 순서: ${room.players.map((player) => player.name).join(' → ')}`);

  const goalDeck = shuffle(goals, deps.random);
  room.players.forEach((p, idx) => {
    p.goalOptions = [goalDeck[(idx * 2) % goalDeck.length]!, goalDeck[(idx * 2 + 1) % goalDeck.length]!];
    if (p.bot) p.goal = p.goalOptions[0]!;
  });
}

export function chooseGoal(deps: RuleDeps, room: Room, playerId: string, goalId: string): void {
  if (room.phase !== 'goal') throw ruleError('지금은 목표를 선택할 수 없습니다.');
  const p = mustPlayer(room, playerId);
  const goal = p.goalOptions.find((g) => g.id === goalId);
  if (!goal) throw ruleError('선택할 수 없는 목표입니다.');
  p.goal = goal;
  addEvent(deps, room, 'goal_ready', `${p.name}님이 비밀 목표를 선택했습니다.`, p.id);
  maybeBeginDraft(deps, room);
}

function maybeBeginDraft(deps: RuleDeps, room: Room): void {
  if (!room.players.every((p) => p.goal)) return;
  room.phase = 'draft';
  room.currentPlayerIndex = 0;
  addEvent(deps, room, 'round_start', '드래프트를 시작합니다. 차례가 오면 카드를 한 장 뽑습니다.');
  drawForTurn(deps, room);
}

/**
 * Draws the card the player on turn will place.
 *
 * A reverse card is not a card you can play: it flips the order and is set
 * aside, then another is drawn in its place. The flip is held until the turn
 * finishes, so the player still acts before the order changes.
 */
function drawForTurn(deps: RuleDeps, room: Room): void {
  room.drawn = null;
  while (room.deck.length) {
    const card = room.deck.shift()!;
    if (card.kind !== 'order-reverse') {
      room.drawn = card;
      armTurnClock(deps, room);
      return;
    }
    room.discard.push(card);
    room.reversePending = true;
    const seat = room.players[room.currentPlayerIndex];
    addEvent(deps, room, 'reverse', `순서 바꾸기 카드가 나왔습니다. 이 턴 뒤로 순서가 뒤집힙니다.`, seat?.id ?? null);
  }
}

export function submitPick(
  deps: RuleDeps,
  room: Room,
  playerId: string,
  cardId: string,
  marketCardId: string | null = null,
): void {
  if (room.phase !== 'draft') throw ruleError('지금은 카드를 선택할 수 없습니다.');
  const p = mustPlayer(room, playerId);
  const current = room.players[room.currentPlayerIndex];
  if (!current || current.id !== playerId) throw ruleError('현재 당신의 턴이 아닙니다.');
  if (!room.drawn) throw ruleError('뽑은 카드가 없습니다.');
  if (room.drawn.id !== cardId) throw ruleError('뽑은 카드가 아닙니다.');
  const card = room.drawn;

  let market: Card | null = null;
  if (marketCardId) {
    market = room.market.find((c) => c.id === marketCardId) ?? null;
    if (!market) throw ruleError('시장에 없는 카드입니다.');
  }

  const before = new Set(claimableCombos(p.playArea).map(comboKey));
  resolveTurn(deps, room, p, card, market);
  awardClaims(deps, room, p, newClaims(room, p, before));
  advanceTurn(deps, room);
}

/** Combos this player has just finished that nobody has declared yet. */
function newClaims(room: Room, player: Player, before: ReadonlySet<string>): string[] {
  return claimableCombos(player.playArea)
    .map(comboKey)
    .filter((key) => !before.has(key) && !room.claimedCombos.includes(key));
}

export function playBotTurn(deps: RuleDeps, room: Room, playerId: string): void {
  if (room.phase !== 'draft') throw ruleError('지금은 봇이 행동할 수 없습니다.');
  const player = room.players[room.currentPlayerIndex];
  if (!player?.bot || player.id !== playerId) throw ruleError('현재 봇의 턴이 아닙니다.');
  if (!room.drawn) throw ruleError('뽑은 카드가 없습니다.');

  // Take the market card instead when it is clearly worth more than the draw.
  const drawn = room.drawn;
  const best = room.market
    .map((card) => ({ card, value: botValue(deps, card, player) }))
    .sort((a, b) => b.value - a.value)[0];
  const swap = best && best.value > botValue(deps, drawn, player) + 2 ? best.card : null;

  const before = new Set(claimableCombos(player.playArea).map(comboKey));
  resolveTurn(deps, room, player, drawn, swap);
  awardClaims(deps, room, player, newClaims(room, player, before));
  advanceTurn(deps, room);
}

function botValue(deps: RuleDeps, card: Card, player: Player): number {
  if (card.kind === 'wildcard') return 100;
  if (card.kind.includes('wildcard')) return 25;
  if (card.kind === 'utility') return 5 + player.playArea.filter((c) => c.kind === 'utility').length * 2;
  const sameContainer = player.playArea.filter((c) => c.container === card.container).length;
  const duplicate = player.playArea.some((c) => c.container === card.container && c.operation === card.operation);
  const rare = ['chain', 'traverse', 'bimap', 'zero'].includes(card.operation) ? 3 : 0;
  return sameContainer * 3 + (duplicate ? -2 : 4) + rare + deps.random();
}

function resolveTurn(deps: RuleDeps, room: Room, player: Player, selected: Card, marketCard: Card | null = null): void {
  room.drawn = null;
  let gained = selected;

  if (marketCard) {
    const marketIndex = room.market.findIndex((c) => c.id === marketCard.id);
    if (marketIndex < 0) throw ruleError('시장에 없는 카드입니다.');
    gained = room.market[marketIndex]!;
    room.market[marketIndex] = selected;
  }

  player.playArea.push(gained);
  room.lastReveal = [{ playerId: player.id, playerName: player.name, card: gained }];
  const message = marketCard
    ? `${player.name}: ${selected.label} → 시장, ${gained.label} 획득`
    : `${player.name}님이 ${gained.label}을 플레이했습니다.`;
  addEvent(deps, room, marketCard ? 'market' : 'pick', message, player.id);
}

function advanceTurn(deps: RuleDeps, room: Room): void {

  const played = room.players.reduce((sum, player) => sum + player.playArea.length, 0);
  recordScores(room, played);

  if (played >= room.players.length * CARDS_PER_PLAYER || (!room.deck.length && !room.drawn)) {
    room.phase = 'finished';
    room.currentPlayerIndex = 0;
    room.drawn = null;
    room.turnEndsAt = null;
    addEvent(deps, room, 'game_end', '게임이 종료됐습니다. 최종 점수를 확인하세요.');
    return;
  }

  // Draw before choosing the next seat: a reverse card turned up by this draw
  // changes who comes next, not the seat after that. The player who just acted
  // had already placed their card, so they are unaffected.
  drawForTurn(deps, room);

  if (room.reversePending) {
    room.reversePending = false;
    room.direction = room.direction === 'left' ? 'right' : 'left';
    addEvent(deps, room, 'reverse', `진행 순서가 ${directionName(room.direction)} 방향으로 바뀝니다.`);
  }

  const n = room.players.length;
  room.currentPlayerIndex = room.direction === 'left'
    ? (room.currentPlayerIndex + 1) % n
    : (room.currentPlayerIndex - 1 + n) % n;
}

/**
 * Snapshots every player's public total for this turn.
 *
 * Scores are derived from the play area, so they could be recomputed from the
 * final board — but not the shape of how they got there. A chart of who pulled
 * ahead when needs the value as it stood, so it is recorded as it happens.
 */
function recordScores(room: Room, turn: number): void {
  const totals: Record<string, number> = {};
  for (const player of room.players) totals[player.id] = scorePlayer(player).total;
  room.scoreLog.push({ turn, totals });
}

const directionName = (direction: string): string => (direction === 'left' ? '왼쪽' : '오른쪽');

export function setPlayerConnection(deps: RuleDeps, room: Room, playerId: string, connected: boolean): void {
  const player = mustPlayer(room, playerId);
  if (player.connected === connected) return;
  player.connected = connected;
  addEvent(
    deps,
    room,
    connected ? 'reconnect' : 'disconnect',
    `${player.name}님의 연결이 ${connected ? '복구됐습니다' : '끊겼습니다'}.`,
    player.id,
  );
}

export function goalScore(player: Pick<Player, 'playArea' | 'goal'>): number {
  if (!player.goal) return 0;
  const combos = findCombos(player.playArea);
  const exact = (container: ContainerName, op: string): boolean =>
    player.playArea.some((c) => c.kind === 'container-function' && c.container === container && c.operation === op);
  const goal: Goal = player.goal;
  let ok = false;
  if (goal.id === 'specialist') {
    const count: Record<string, number> = {};
    combos.forEach((c) => { count[c.container] = (count[c.container] || 0) + 1; });
    ok = Object.values(count).some((n) => n >= 2);
  } else if (goal.id === 'generalist') ok = new Set(combos.map((c) => c.container)).size >= 3;
  else if (goal.id === 'purist') {
    ok = (['Maybe', 'Either', 'List', 'Task'] as const).some((c) => ['map', 'ap', 'pure', 'chain'].every((op) => exact(c, op)));
  } else if (goal.id === 'utility-belt') ok = scoreUtilities(player.playArea).count >= 5;
  else if (goal.id === 'polyglot') ok = (['Maybe', 'Either', 'List', 'Task'] as const).every((c) => exact(c, 'map'));
  else if (goal.id === 'collector') ok = new Set(player.playArea.filter((c) => c.operation).map((c) => c.operation)).size >= 7;
  return ok ? goal.score : 0;
}

function addEvent(deps: RuleDeps, room: Room, type: EventType, message: string, playerId: string | null = null): void {
  room.events.push({ id: deps.id('event'), type, message, playerId });
  if (room.events.length > 30) room.events.splice(0, room.events.length - 30);
}

export function actionOrder(room: Room): string[] {
  const n = room.players.length;
  if (!n) return [];
  const step = room.direction === 'left' ? 1 : -1;
  return room.players.map((_, offset) =>
    room.players[(room.currentPlayerIndex + offset * step + n * n) % n]!.id);
}

/**
 * Declares every combo finished on this turn.
 *
 * Claiming used to be offered as a choice, and it was not one: a claim costs
 * nothing, pays a point, and locks the combo away from everyone else, so
 * declining was strictly worse — and the offer only ever came on the turn the
 * combo was completed, so declining forfeited it for good. A prompt that stops
 * the game for a decision with one right answer is friction, not depth.
 *
 * Finishing several at once is worth more than finishing them apart. Holding
 * `Maybe.ap` back until map, pure, alt and zero are down completes Apply,
 * Applicative and Alternative on one card, and that is planning: the nth combo
 * declared together pays n, so three at once pays six rather than three.
 */
function awardClaims(deps: RuleDeps, room: Room, player: Player, keys: readonly string[]): void {
  if (keys.length === 0) return;

  keys.forEach((key, index) => {
    room.claimedCombos.push(key);
    player.claims.push(key);
    player.claimPoints += index + 1;
  });

  const points = (keys.length * (keys.length + 1)) / 2;
  const names = keys.map((key) => key.replace(':', ' ')).join(', ');
  addEvent(
    deps,
    room,
    'claim',
    keys.length > 1
      ? `${player.name}님이 ${keys.length}개를 한 번에 Claim했습니다: ${names}. +${points}점`
      : `${player.name}님이 ${names}을 Claim했습니다. +1점`,
    player.id,
  );
}

function mustPlayer(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw ruleError('플레이어를 찾을 수 없습니다.');
  return p;
}
