import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DraftRoom } from './draft-room.ts';

const port = Number(process.env.COLYSEUS_PORT ?? 2567);

const gameServer = new Server({ transport: new WebSocketTransport() });
gameServer.define('draft', DraftRoom);

await gameServer.listen(port);
console.log(`Colyseus listening on ws://0.0.0.0:${port}`);
