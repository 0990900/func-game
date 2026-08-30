import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DraftRoom } from './draft-room.ts';

const port = Number(process.env.COLYSEUS_PORT ?? 2567);

const transport = new WebSocketTransport();
const gameServer = new Server({ transport });
gameServer.define('draft', DraftRoom);

/**
 * The open rooms, for the lobby list.
 *
 * Served over plain HTTP rather than through the client SDK: the SDK's
 * room-listing helper was dropped, and asking the matchmaker directly is both
 * smaller and not something a future SDK release can take away. Only what a
 * room chose to publish about itself is returned — never its state.
 */
/** Only what this handler uses, so express's types need not be a dependency. */
interface JsonResponse {
  json: (body: unknown) => unknown;
  status: (code: number) => JsonResponse;
}

transport.getExpressApp().get('/rooms', async (_request: unknown, response: JsonResponse) => {
  try {
    const rooms = await matchMaker.query({ name: 'draft', private: false, locked: false });
    response.json(rooms.map((room) => ({
      roomId: room.roomId,
      clients: room.clients,
      ...(room.metadata ?? {}),
    })));
  } catch (cause) {
    console.error('room list failed:', cause);
    response.status(500).json([]);
  }
});

await gameServer.listen(port);
console.log(`Colyseus listening on ws://0.0.0.0:${port}`);
