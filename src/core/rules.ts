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
import { comboKey, findCombos } from './combos.ts';
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

export interface RuleDeps {
  readonly id: (prefix: string) => string;
  readonly random: () => number;
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
    hand: [],
    playArea: [],
    goalOptions: [],
    goal: null,
    claims: [],
    connected: true,
  };
}

export function createRoom(deps: RuleDeps, hostName = 'Player'): Room {
  const host = createPlayer(deps, hostName, false);
  return {
    id: deps.id('room'),
    phase: 'lobby',
    round: 0,
    pick: 0,
    direction: 'left',
    hostPlayerId: host.id,
    players: [host],
    deck: [],
    market: [],
    currentPlayerIndex: 0,
    turnsThisPick: 0,
    pendingClaim: null,
    lastReveal: [],
    claimedCombos: [],
    events: [],
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

export function addBotsToFour(deps: RuleDeps, room: Room): void {
  let i = 1;
  while (room.players.length < MAX_PLAYERS) room.players.push(createPlayer(deps, `Bot ${i++}`, true));
}

export function startGame(deps: RuleDeps, room: Room): void {
  if (room.phase !== 'lobby') throw ruleError('게임이 이미 시작되었습니다.');
  // The legacy core branched on `players.length < 2` with identical bodies;
  // collapsed here because the branch was provably behavior-free.
  addBotsToFour(deps, room);

  room.players = shuffle(room.players, deps.random);
  room.deck = shuffle(createDeck(), deps.random);
  room.market = room.deck.splice(0, 4);
  room.round = 1;
  room.pick = 1;
  room.direction = 'left';
  room.phase = 'goal';
  room.lastReveal = [];
  room.currentPlayerIndex = 0;
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
  if (room.players.every((p) => p.goal)) {
    room.phase = 'draft';
    dealRound(room);
    addEvent(deps, room, 'round_start', 'Round 1이 시작됐습니다. 손패는 왼쪽으로 전달됩니다.');
  }
}

function dealRound(room: Room): void {
  room.players.forEach((p) => { p.hand = room.deck.splice(0, 5); });
  preparePick(room);
}

export function submitPick(
  deps: RuleDeps,
  room: Room,
  playerId: string,
  cardId: string,
  marketCardId: string | null = null,
): void {
  if (room.phase !== 'draft') throw ruleError('지금은 카드를 선택할 수 없습니다.');
  if (room.pendingClaim) throw ruleError('Claim 선택을 먼저 마쳐야 합니다.');
  const p = mustPlayer(room, playerId);
  const current = room.players[room.currentPlayerIndex];
  if (!current || current.id !== playerId) throw ruleError('현재 당신의 턴이 아닙니다.');
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) throw ruleError('손패에 없는 카드입니다.');

  let market: Card | null = null;
  if (marketCardId) {
    market = room.market.find((c) => c.id === marketCardId) ?? null;
    if (!market) throw ruleError('시장에 없는 카드입니다.');
  }

  const before = new Set(findCombos(p.playArea).map(comboKey));
  resolveTurn(deps, room, p, card, market);
  const claimKeys = findCombos(p.playArea)
    .map(comboKey)
    .filter((key) => !before.has(key) && !room.claimedCombos.includes(key));
  if (claimKeys.length) {
    room.pendingClaim = { playerId: p.id, keys: claimKeys };
    addEvent(deps, room, 'claim_ready', `${p.name}님이 새 조합을 완성했습니다. Claim을 선택합니다.`, p.id);
  } else advanceTurn(deps, room);
}

export function playBotTurn(deps: RuleDeps, room: Room, playerId: string): void {
  if (room.phase !== 'draft' || room.pendingClaim) throw ruleError('지금은 봇이 행동할 수 없습니다.');
  const player = room.players[room.currentPlayerIndex];
  if (!player?.bot || player.id !== playerId) throw ruleError('현재 봇의 턴이 아닙니다.');
  if (!player.hand.length) throw ruleError('봇의 손패가 비어 있습니다.');
  const card = [...player.hand].sort((a, b) => botValue(deps, b, player) - botValue(deps, a, player))[0]!;
  const before = new Set(findCombos(player.playArea).map(comboKey));
  resolveTurn(deps, room, player, card, null);
  findCombos(player.playArea)
    .map(comboKey)
    .filter((key) => !before.has(key) && !room.claimedCombos.includes(key))
    .forEach((key) => awardClaim(deps, room, player, key));
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
  const handIndex = player.hand.findIndex((c) => c.id === selected.id);
  player.hand.splice(handIndex, 1);
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
  room.pendingClaim = null;
  room.turnsThisPick += 1;

  if (room.turnsThisPick >= room.players.length) {
    if (room.pick >= 5) {
      if (room.round >= 3) {
        room.phase = 'finished';
        room.currentPlayerIndex = 0;
        addEvent(deps, room, 'game_end', '게임이 종료됐습니다. 최종 점수를 확인하세요.');
        return;
      }
      room.round += 1;
      room.pick = 1;
      room.direction = room.round === 2 ? 'right' : 'left';
      dealRound(room);
      addEvent(deps, room, 'round_start', `Round ${room.round}가 시작됐습니다. 손패는 ${room.direction === 'left' ? '왼쪽' : '오른쪽'}으로 전달됩니다.`);
    } else {
      rotateHands(room);
      room.pick += 1;
      preparePick(room);
      addEvent(deps, room, 'pass', `모든 플레이어가 행동했습니다. 손패를 ${room.direction === 'left' ? '왼쪽' : '오른쪽'}으로 전달합니다.`);
    }
  } else room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
}

function rotateHands(room: Room): void {
  const oldHands = room.players.map((p) => p.hand);
  const n = room.players.length;
  room.players.forEach((p, i) => {
    const source = room.direction === 'left' ? (i - 1 + n) % n : (i + 1) % n;
    p.hand = oldHands[source]!;
  });
}

export function claimCombo(deps: RuleDeps, room: Room, playerId: string, container: string, name: string): void {
  const p = mustPlayer(room, playerId);
  const key = `${container}:${name}`;
  if (room.pendingClaim?.playerId !== playerId || !room.pendingClaim.keys.includes(key)) {
    throw ruleError('지금 Claim할 수 없는 조합입니다.');
  }
  if (room.claimedCombos.includes(key)) throw ruleError('이미 Claim된 조합입니다.');
  const possible = findCombos(p.playArea).some((c) => c.container === container && c.name === name);
  if (!possible) throw ruleError('아직 완성되지 않은 조합입니다.');
  awardClaim(deps, room, p, key);
  room.pendingClaim.keys = room.pendingClaim.keys.filter((candidate) => candidate !== key);
  if (!room.pendingClaim.keys.length) advanceTurn(deps, room);
}

export function finishClaim(deps: RuleDeps, room: Room, playerId: string): void {
  if (room.pendingClaim?.playerId !== playerId) throw ruleError('지금은 Claim 선택을 마칠 수 없습니다.');
  advanceTurn(deps, room);
}

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

function preparePick(room: Room): void {
  const globalPick = (room.round - 1) * 5 + room.pick - 1;
  room.currentPlayerIndex = globalPick % room.players.length;
  room.turnsThisPick = 0;
  room.pendingClaim = null;
}

export function actionOrder(room: Room): string[] {
  if (!room.players.length) return [];
  const globalPick = Math.max(0, (room.round - 1) * 5 + room.pick - 1);
  const starter = globalPick % room.players.length;
  return room.players.map((_, offset) => room.players[(starter + offset) % room.players.length]!.id);
}

function awardClaim(deps: RuleDeps, room: Room, player: Player, key: string): void {
  const [container, name] = key.split(':');
  room.claimedCombos.push(key);
  player.claims.push(key);
  addEvent(deps, room, 'claim', `${player.name}님이 ${container} ${name}을 Claim했습니다. +1점`, player.id);
}

function mustPlayer(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw ruleError('플레이어를 찾을 수 없습니다.');
  return p;
}
