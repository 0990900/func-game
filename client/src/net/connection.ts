/**
 * The Colyseus connection. Everything the server says arrives here and is
 * written into the store; everything the player does leaves through `send`.
 */
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { PublicState } from '../../../src/core/types.ts';

const endpoint = (): string => {
  const configured = import.meta.env['VITE_COLYSEUS_URL'];
  if (typeof configured === 'string' && configured) return configured;
  if (import.meta.env.DEV) return 'ws://localhost:2567';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}`;
};

export const client = new Client(endpoint());

export interface Handlers {
  readonly onState: (state: PublicState) => void;
  readonly onError: (message: string) => void;
  readonly onLeave: (code: number) => void;
}

export type GameRoom = Room;

function bind(room: GameRoom, handlers: Handlers): GameRoom {
  room.onMessage('state', (message: { state: PublicState }) => handlers.onState(message.state));
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
