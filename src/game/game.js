import crypto from 'node:crypto';
import { Maybe } from 'fun-fp-js';
import { createDeck } from './cards.js';
import { shuffle } from './random.js';
import { goals } from './goals.js';
import { findCombos } from './combos.js';
import { scorePlayer, scoreUtilities } from './scoring.js';

const MAX_PLAYERS = 4;

function id(prefix) { return `${prefix}-${crypto.randomBytes(4).toString('hex')}`; }

export function createRoom(hostName = 'Player') {
  const host = createPlayer(hostName, false);
  return {
    id: id('room'),
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

export function createPlayer(name, bot = false) {
  return {
    id: id(bot ? 'bot' : 'player'),
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

export function joinRoom(room, name) {
  if (room.phase !== 'lobby') throw new Error('이미 시작된 게임입니다.');
  if (room.players.length >= MAX_PLAYERS) throw new Error('방이 가득 찼습니다.');
  const player = createPlayer(name, false);
  room.players.push(player);
  addEvent(room, 'join', `${player.name}님이 방에 참가했습니다.`, player.id);
  return player;
}

export function addBotsToFour(room) {
  let i = 1;
  while (room.players.length < MAX_PLAYERS) room.players.push(createPlayer(`Bot ${i++}`, true));
}

export function startGame(room) {
  if (room.phase !== 'lobby') throw new Error('게임이 이미 시작되었습니다.');
  if (room.players.length < 2) addBotsToFour(room);
  else addBotsToFour(room);

  room.players = shuffle(room.players);
  room.deck = shuffle(createDeck());
  room.market = room.deck.splice(0, 4);
  room.round = 1;
  room.pick = 1;
  room.direction = 'left';
  room.phase = 'goal';
  room.lastReveal = [];
  room.currentPlayerIndex = 0;
  addEvent(room, 'game_start', '게임을 시작합니다. 비밀 목표를 선택하세요.');
  addEvent(room, 'turn_order', `자리 순서: ${room.players.map((player) => player.name).join(' → ')}`);

  const goalDeck = shuffle(goals);
  room.players.forEach((p, idx) => {
    p.goalOptions = [goalDeck[(idx * 2) % goalDeck.length], goalDeck[(idx * 2 + 1) % goalDeck.length]];
    if (p.bot) p.goal = p.goalOptions[0];
  });
}

export function chooseGoal(room, playerId, goalId) {
  if (room.phase !== 'goal') throw new Error('지금은 목표를 선택할 수 없습니다.');
  const p = mustPlayer(room, playerId);
  const goal = p.goalOptions.find((g) => g.id === goalId);
  if (!goal) throw new Error('선택할 수 없는 목표입니다.');
  p.goal = goal;
  addEvent(room, 'goal_ready', `${p.name}님이 비밀 목표를 선택했습니다.`, p.id);
  maybeBeginDraft(room);
}

function maybeBeginDraft(room) {
  if (room.players.every((p) => p.goal)) {
    room.phase = 'draft';
    dealRound(room);
    addEvent(room, 'round_start', 'Round 1이 시작됐습니다. 손패는 왼쪽으로 전달됩니다.');
    advanceBots(room);
  }
}

function dealRound(room) {
  room.players.forEach((p) => { p.hand = room.deck.splice(0, 5); });
  preparePick(room);
}

export function submitPick(room, playerId, cardId, marketCardId = null) {
  if (room.phase !== 'draft') throw new Error('지금은 카드를 선택할 수 없습니다.');
  if (room.pendingClaim) throw new Error('Claim 선택을 먼저 마쳐야 합니다.');
  const p = mustPlayer(room, playerId);
  const current = room.players[room.currentPlayerIndex];
  if (!current || current.id !== playerId) throw new Error('현재 당신의 턴이 아닙니다.');
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) throw new Error('손패에 없는 카드입니다.');

  let market = null;
  if (marketCardId) {
    market = room.market.find((c) => c.id === marketCardId);
    if (!market) throw new Error('시장에 없는 카드입니다.');
  }

  const before = new Set(findCombos(p.playArea).map(comboKey));
  resolveTurn(room, p, card, market);
  const claimKeys = findCombos(p.playArea)
    .map(comboKey)
    .filter((key) => !before.has(key) && !room.claimedCombos.includes(key));
  if (claimKeys.length) {
    room.pendingClaim = { playerId: p.id, keys: claimKeys };
    addEvent(room, 'claim_ready', `${p.name}님이 새 조합을 완성했습니다. Claim을 선택합니다.`, p.id);
  } else advanceTurn(room);
}

function advanceBots(room) {
  while (room.phase === 'draft') {
    const p = room.players[room.currentPlayerIndex];
    if (!p?.bot) return;
    if (!p.hand.length) return;
    const card = [...p.hand].sort((a, b) => botValue(b, p) - botValue(a, p))[0];
    const before = new Set(findCombos(p.playArea).map(comboKey));
    resolveTurn(room, p, card, null);
    findCombos(p.playArea)
      .map(comboKey)
      .filter((key) => !before.has(key) && !room.claimedCombos.includes(key))
      .forEach((key) => awardClaim(room, p, key));
    advanceTurn(room, false);
  }
}

function botValue(card, player) {
  if (card.kind === 'wildcard') return 100;
  if (card.kind.includes('wildcard')) return 25;
  if (card.kind === 'utility') return 5 + player.playArea.filter((c) => c.kind === 'utility').length * 2;
  const sameContainer = player.playArea.filter((c) => c.container === card.container).length;
  const duplicate = player.playArea.some((c) => c.container === card.container && c.operation === card.operation);
  const rare = ['chain', 'traverse', 'bimap', 'zero'].includes(card.operation) ? 3 : 0;
  return sameContainer * 3 + (duplicate ? -2 : 4) + rare + Math.random();
}

function resolveTurn(room, player, selected, marketCard = null) {
  const handIndex = player.hand.findIndex((c) => c.id === selected.id);
  player.hand.splice(handIndex, 1);
  let gained = selected;

  if (marketCard) {
    const marketIndex = room.market.findIndex((c) => c.id === marketCard.id);
    if (marketIndex < 0) throw new Error('시장에 없는 카드입니다.');
    gained = room.market[marketIndex];
    room.market[marketIndex] = selected;
  }

  player.playArea.push(gained);
  room.lastReveal = [{ playerId: player.id, playerName: player.name, card: gained }];
  const message = marketCard
    ? `${player.name}: ${selected.label} → 시장, ${gained.label} 획득`
    : `${player.name}님이 ${gained.label}을 플레이했습니다.`;
  addEvent(room, marketCard ? 'market' : 'pick', message, player.id);
}

function advanceTurn(room, runBots = true) {
  room.pendingClaim = null;
  room.turnsThisPick += 1;

  if (room.turnsThisPick >= room.players.length) {
    if (room.pick >= 5) {
      if (room.round >= 3) {
        room.phase = 'finished';
        room.currentPlayerIndex = 0;
        addEvent(room, 'game_end', '게임이 종료됐습니다. 최종 점수를 확인하세요.');
        return;
      }
      room.round += 1;
      room.pick = 1;
      room.direction = room.round === 2 ? 'right' : 'left';
      dealRound(room);
      addEvent(room, 'round_start', `Round ${room.round}가 시작됐습니다. 손패는 ${room.direction === 'left' ? '왼쪽' : '오른쪽'}으로 전달됩니다.`);
    } else {
      rotateHands(room);
      room.pick += 1;
      preparePick(room);
      addEvent(room, 'pass', `모든 플레이어가 행동했습니다. 손패를 ${room.direction === 'left' ? '왼쪽' : '오른쪽'}으로 전달합니다.`);
    }
  } else room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

  if (runBots) advanceBots(room);
}

function rotateHands(room) {
  const oldHands = room.players.map((p) => p.hand);
  const n = room.players.length;
  room.players.forEach((p, i) => {
    const source = room.direction === 'left' ? (i - 1 + n) % n : (i + 1) % n;
    p.hand = oldHands[source];
  });
}

export function claimCombo(room, playerId, container, name) {
  const p = mustPlayer(room, playerId);
  const key = `${container}:${name}`;
  if (room.pendingClaim?.playerId !== playerId || !room.pendingClaim.keys.includes(key)) throw new Error('지금 Claim할 수 없는 조합입니다.');
  if (room.claimedCombos.includes(key)) throw new Error('이미 Claim된 조합입니다.');
  const possible = findCombos(p.playArea).some((c) => c.container === container && c.name === name);
  if (!possible) throw new Error('아직 완성되지 않은 조합입니다.');
  awardClaim(room, p, key);
  room.pendingClaim.keys = room.pendingClaim.keys.filter((candidate) => candidate !== key);
  if (!room.pendingClaim.keys.length) advanceTurn(room);
}

export function finishClaim(room, playerId) {
  if (room.pendingClaim?.playerId !== playerId) throw new Error('지금은 Claim 선택을 마칠 수 없습니다.');
  advanceTurn(room);
}

export function setPlayerConnection(room, playerId, connected) {
  const player = mustPlayer(room, playerId);
  if (player.connected === connected) return;
  player.connected = connected;
  addEvent(room, connected ? 'reconnect' : 'disconnect', `${player.name}님의 연결이 ${connected ? '복구됐습니다' : '끊겼습니다'}.`, player.id);
}

function goalScore(player) {
  if (!player.goal) return 0;
  const combos = findCombos(player.playArea);
  const exact = (container, op) => player.playArea.some((c) => c.kind === 'container-function' && c.container === container && c.operation === op);
  const goal = player.goal;
  let ok = false;
  if (goal.id === 'specialist') {
    const count = {};
    combos.forEach((c) => { count[c.container] = (count[c.container] || 0) + 1; });
    ok = Object.values(count).some((n) => n >= 2);
  } else if (goal.id === 'generalist') ok = new Set(combos.map((c) => c.container)).size >= 3;
  else if (goal.id === 'purist') ok = ['Maybe', 'Either', 'List', 'Task'].some((c) => ['map', 'ap', 'pure', 'chain'].every((op) => exact(c, op)));
  else if (goal.id === 'utility-belt') ok = scoreUtilities(player.playArea).count >= 5;
  else if (goal.id === 'polyglot') ok = ['Maybe', 'Either', 'List', 'Task'].every((c) => exact(c, 'map'));
  else if (goal.id === 'collector') ok = new Set(player.playArea.filter((c) => c.operation).map((c) => c.operation)).size >= 7;
  return ok ? goal.score : 0;
}

export function publicState(room, viewerId) {
  const viewer = Maybe.fromNullable(room.players.find((p) => p.id === viewerId));
  const turnsCompleted = room.players.reduce((sum, player) => sum + player.playArea.length, 0);
  const scores = room.phase === 'finished'
    ? room.players.map((p) => {
        const base = scorePlayer(p);
        const goal = goalScore(p);
        return { playerId: p.id, name: p.name, ...base, goalScore: goal, total: base.total + goal };
      }).sort((a, b) => b.total - a.total)
    : null;

  return Maybe.fold(
    () => projectPublicState(room, null, turnsCompleted, scores),
    (player) => projectPublicState(room, player, turnsCompleted, scores),
    viewer,
  );
}

function projectPublicState(room, viewer, turnsCompleted, scores) {
  return {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    pick: room.pick,
    direction: room.direction,
    progress: {
      roundsTotal: 3,
      picksPerRound: 5,
      turnsCompleted,
      turnsTotal: 60,
      myPicks: viewer?.playArea.length || 0,
      myPicksTotal: 15,
      turnsThisPick: room.turnsThisPick,
    },
    hostPlayerId: room.hostPlayerId,
    me: viewer ? {
      id: viewer.id,
      name: viewer.name,
      hand: viewer.hand,
      goalOptions: room.phase === 'goal' ? viewer.goalOptions : [],
      goal: viewer.goal,
      isMyTurn: room.phase === 'draft' && !room.pendingClaim && room.players[room.currentPlayerIndex]?.id === viewer.id,
      availableClaims: room.pendingClaim?.playerId === viewer.id
        ? findCombos(viewer.playArea).filter((combo) => room.pendingClaim.keys.includes(comboKey(combo)) && !room.claimedCombos.includes(comboKey(combo)))
        : [],
      canFinishClaim: room.pendingClaim?.playerId === viewer.id,
    } : null,
    currentPlayerId: room.phase === 'draft' ? room.players[room.currentPlayerIndex]?.id || null : null,
    turnOrder: actionOrder(room),
    market: room.market,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      connected: p.connected,
      playArea: p.playArea,
      claimCount: p.claims.length,
      cardCount: p.playArea.length,
      status: playerStatus(room, p),
      publicScore: publicScore(p),
    })),
    lastReveal: room.lastReveal,
    events: room.events.slice(-30).reverse(),
    scores,
  };
}

function publicScore(player) {
  const score = scorePlayer(player);
  return {
    comboScore: score.comboScore,
    utilityScore: score.utilityScore,
    claimScore: score.claimScore,
    total: score.total,
  };
}

function playerStatus(room, player) {
  if (!player.connected) return 'disconnected';
  if (room.phase === 'goal') return player.goal ? 'ready' : 'choosing_goal';
  if (room.phase === 'draft') {
    if (room.pendingClaim?.playerId === player.id) return 'claiming';
    return room.players[room.currentPlayerIndex]?.id === player.id ? 'playing' : 'waiting';
  }
  if (room.phase === 'finished') return 'finished';
  return 'lobby';
}

function addEvent(room, type, message, playerId = null) {
  room.events.push({ id: id('event'), type, message, playerId });
  if (room.events.length > 30) room.events.splice(0, room.events.length - 30);
}

function preparePick(room) {
  const globalPick = (room.round - 1) * 5 + room.pick - 1;
  room.currentPlayerIndex = globalPick % room.players.length;
  room.turnsThisPick = 0;
  room.pendingClaim = null;
}

function actionOrder(room) {
  if (!room.players.length) return [];
  const globalPick = Math.max(0, (room.round - 1) * 5 + room.pick - 1);
  const starter = globalPick % room.players.length;
  return room.players.map((_, offset) => room.players[(starter + offset) % room.players.length].id);
}

function comboKey(combo) { return `${combo.container}:${combo.name}`; }

function awardClaim(room, player, key) {
  const [container, name] = key.split(':');
  room.claimedCombos.push(key);
  player.claims.push(key);
  addEvent(room, 'claim', `${player.name}님이 ${container} ${name}을 Claim했습니다. +1점`, player.id);
}

function mustPlayer(room, playerId) {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new Error('플레이어를 찾을 수 없습니다.');
  return p;
}
