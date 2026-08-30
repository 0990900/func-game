/**
 * The Colyseus connection. Everything the server says arrives here and is
 * written into the store; everything the player does leaves through `send`.
 */
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { PublicState } from '../../../src/core/types.ts';

const DEV_SERVER_PORT = 2567;

/** Where the game server is. */
const endpoint = (): string => {
  const configured = import.meta.env['VITE_COLYSEUS_URL'];
  if (typeof configured === 'string' && configured) return configured;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev the game server is a second process on its own port. Reuse the
  // hostname the page was opened with — hardcoding localhost breaks the moment
  // the page is opened by hostname, LAN address or from a phone.
  if (import.meta.env.DEV) return `${protocol}//${location.hostname}:${DEV_SERVER_PORT}`;
  // In production one server serves both the page and the game.
  return `${protocol}//${location.host}`;
};

export const client = new Client(endpoint());

export interface Handlers {
  /** `serverNow` is the server's clock when it sent, for the turn countdown. */
  readonly onState: (state: PublicState, serverNow: number) => void;
  readonly onError: (message: string) => void;
  readonly onLeave: (code: number) => void;
}

export type GameRoom = Room;

function bind(room: GameRoom, handlers: Handlers): GameRoom {
  room.onMessage('state', (message: { state: PublicState; serverNow?: number }) =>
    handlers.onState(message.state, message.serverNow ?? Date.now()));
  room.onMessage('error', (message: { message: string }) => handlers.onError(message.message));
  room.onLeave((code: number) => handlers.onLeave(code));
  return room;
}

export async function createRoom(name: string, handlers: Handlers): Promise<GameRoom> {
  return bind(await client.create('draft', { name }), handlers);
}

export async function joinRoom(roomId: string, name: string, handlers: Handlers): Promise<GameRoom> {
  return bind(await client.joinById(roomId, { name }), handlers);
}

export async function resumeRoom(token: string, handlers: Handlers): Promise<GameRoom> {
  return bind(await client.reconnect(token), handlers);
}
