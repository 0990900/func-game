import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { gameStore } from './game-store.js';
import { sendToActor } from './room-actor.js';
import { Game } from '../game/program.js';
import { createRoom, publicState } from '../game/game.js';

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

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await handle(ws, msg);
    } catch (error) {
      send(ws, 'error', { message: error.message || '잘못된 요청입니다.' });
    }
  });

  ws.on('close', async () => {
    const ctx = clients.get(ws);
    if (ctx?.roomId && ctx?.playerId) {
      const actor = gameStore.actor(ctx.roomId);
      const player = actor?.getState().players.find((candidate) => candidate.id === ctx.playerId);
      if (actor && player) {
        await sendToActor(actor, Game.setConnection(player.id, false));
        broadcastRoom(actor.getState());
      }
    }
    clients.delete(ws);
  });
});

async function handle(ws, msg) {
  const ctx = clients.get(ws);
  if (msg.type === 'create_room') {
    const room = createRoom(msg.name);
    gameStore.add(room);
    ctx.roomId = room.id; ctx.playerId = room.players[0].id;
    broadcastRoom(room); return;
  }
  if (msg.type === 'join_room') {
    const actor = mustActor(msg.roomId);
    const player = await sendToActor(actor, Game.joinRoom(msg.name));
    ctx.roomId = msg.roomId; ctx.playerId = player.id;
    broadcastRoom(actor.getState()); return;
  }
  const actor = mustActor(ctx.roomId);
  if (msg.type === 'start_game') {
    await sendToActor(actor, Game.startGame(ctx.playerId));
  } else if (msg.type === 'choose_goal') await sendToActor(actor, Game.chooseGoal(ctx.playerId, msg.goalId));
  else if (msg.type === 'pick') await sendToActor(actor, Game.pick(ctx.playerId, msg.cardId, msg.marketCardId || null));
  else if (msg.type === 'claim') await sendToActor(actor, Game.claim(ctx.playerId, msg.container, msg.name));
  else if (msg.type === 'finish_claim') await sendToActor(actor, Game.finishClaim(ctx.playerId));
  else throw new Error('지원하지 않는 동작입니다.');
  broadcastRoom(actor.getState());
}

function mustActor(roomId) {
  const actor = gameStore.actor(roomId);
  if (!actor) throw new Error('방을 찾을 수 없습니다.');
  return actor;
}
function send(ws, type, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload })); }
function broadcastRoom(room) {
  for (const [ws, ctx] of clients.entries()) {
    if (ctx.roomId === room.id) send(ws, 'state', { state: publicState(room, ctx.playerId) });
  }
}

server.listen(port, '0.0.0.0', () => console.log(`FP Draft Game: http://localhost:${port}`));
