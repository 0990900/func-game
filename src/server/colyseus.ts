import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * The built client, served by the same server that runs the games.
 *
 * One address for one game. Running the table and serving the page used to be
 * two processes on two ports, which is fine on the machine they were written on
 * and a trap everywhere else: `npm start` reached the old stack, and anyone who
 * cloned the repo and ran it got a game with a hand of cards and rounds that the
 * rules had dropped months earlier.
 *
 * `npm run dev` still runs Vite separately — that is what gives reload on save —
 * and the client points itself at this port when it is served from Vite.
 */
const clientDir = fileURLToPath(new URL('../../client/dist/', import.meta.url));

const CONTENT_TYPE: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

interface FileResponse {
  setHeader: (name: string, value: string) => unknown;
  statusCode: number;
  end: (body?: string) => unknown;
  pipe?: unknown;
}

if (existsSync(clientDir)) {
  transport.getExpressApp().get(/.*/, (request: { path: string }, response: FileResponse) => {
    // Anything that is not a file on disk is the app itself: the client routes
    // in the browser, so a deep link has to come back as index.html.
    const relative = normalize(request.path).replace(/^([/\\])+/, '');
    // `normalize` collapses `..`, but a path that still climbs out is refused
    // rather than served: this reads from disk on request.
    const candidate = relative.startsWith(`..${sep}`) ? '' : join(clientDir, relative);
    const file = candidate && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(clientDir, 'index.html');

    response.setHeader('Content-Type', CONTENT_TYPE[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(response as never);
  });
} else {
  console.warn('client/dist not found — run `npm run build` to serve the game from this port.');
}

await gameServer.listen(port);
console.log(`FP Draft Game on http://0.0.0.0:${port}`);
