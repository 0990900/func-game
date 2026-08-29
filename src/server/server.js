import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { gameStore } from './game-store.js';
import { createRoom, joinRoom, startGame, chooseGoal, submitPick, claimCombo, publicState, setPlayerConnection } from '../game/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');
const port = Number(process.env.PORT || 3107);
const clients = new Map();

const contentTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(publicDir, `.${pathname}`);
  if (!target.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': contentTypes[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.set(ws, { roomId: null, playerId: null });
  send(ws, 'hello', { message: 'connected' });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handle(ws, msg);
    } catch (error) {
      send(ws, 'error', { message: error.message || '잘못된 요청입니다.' });
    }
  });

  ws.on('close', () => {
    const ctx = clients.get(ws);
    if (ctx?.roomId && ctx?.playerId) {
      const room = gameStore.get(ctx.roomId);
      const p = room?.players.find((x) => x.id === ctx.playerId);
      if (p) setPlayerConnection(room, p.id, false);
      if (room) broadcastRoom(room);
    }
    clients.delete(ws);
  });
});

function handle(ws, msg) {
  const ctx = clients.get(ws);
  if (msg.type === 'create_room') {
    const room = gameStore.add(createRoom(msg.name));
    ctx.roomId = room.id; ctx.playerId = room.players[0].id;
    broadcastRoom(room); return;
  }
  if (msg.type === 'join_room') {
    const room = mustRoom(msg.roomId);
    const player = joinRoom(room, msg.name);
    ctx.roomId = room.id; ctx.playerId = player.id;
    broadcastRoom(room); return;
  }
  const room = mustRoom(ctx.roomId);
  if (msg.type === 'start_game') {
    if (ctx.playerId !== room.hostPlayerId) throw new Error('방장만 시작할 수 있습니다.');
    startGame(room);
  } else if (msg.type === 'choose_goal') chooseGoal(room, ctx.playerId, msg.goalId);
  else if (msg.type === 'pick') submitPick(room, ctx.playerId, msg.cardId, msg.marketCardId || null);
  else if (msg.type === 'claim') claimCombo(room, ctx.playerId, msg.container, msg.name);
  else throw new Error('지원하지 않는 동작입니다.');
  broadcastRoom(room);
}

function mustRoom(roomId) {
  const room = gameStore.get(roomId);
  if (!room) throw new Error('방을 찾을 수 없습니다.');
  return room;
}
function send(ws, type, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload })); }
function broadcastRoom(room) {
  for (const [ws, ctx] of clients.entries()) {
    if (ctx.roomId === room.id) send(ws, 'state', { state: publicState(room, ctx.playerId) });
  }
}

server.listen(port, '0.0.0.0', () => console.log(`FP Draft Game: http://localhost:${port}`));
