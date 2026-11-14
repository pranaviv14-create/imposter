// Production entry point for the game server.   npm start
//
// It runs in one of two ways, decided by whether a built client is present:
//   - Server only (Render): no dist/ folder. Answers the health check, the small
//     JSON API and the /ws game socket. The client is hosted elsewhere (Netlify).
//   - All in one: if dist/ exists (after `npm run build`) it also serves the client,
//     so a single process on a single address runs the whole game.
//
// Environment variables (all optional):
//   PORT              port to listen on (Render sets this)
//   ALLOWED_ORIGINS   comma-separated sites allowed to connect, e.g. https://my-game.netlify.app
//   TURN_URL, TURN_USERNAME, TURN_CREDENTIAL   a TURN relay for players on different networks
//   ICE_SERVERS       full ICE server list as JSON (overrides the three TURN_* variables)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameServer, handleApi, parseAllowedOrigins, type Game } from './game';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT) || 8787;
const host = '0.0.0.0'; // all interfaces — required by Render and other container hosts
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const hasClient = fs.existsSync(path.join(root, 'index.html'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
};

let game: Game;

const server = http.createServer((req, res) => {
  if (handleApi(game, req, res, allowedOrigins)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (!hasClient) {
    // Server-only deployment: there is nothing to browse here.
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('IMPOSTERVERSE LIVE game server is running.\nThe game itself is served from the client site.\n');
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  const hasExt = !!path.extname(file);
  if (!hasExt || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (hasExt) {
      res.writeHead(404).end('Not found');
      return;
    }
    file = path.join(root, 'index.html'); // single-page app fallback
  }
  const ext = path.extname(file);
  const immutable = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(self), microphone=(self)',
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
});

game = attachGameServer(server, { allowedOrigins });

server.listen(port, host, () => {
  console.log(`[server] IMPOSTERVERSE LIVE listening on ${host}:${port} (${hasClient ? 'serving the built client too' : 'game server only'})`);
  if (allowedOrigins.length) console.log('[server] accepting players from:', allowedOrigins.join(', '));
  else console.warn('[server] ALLOWED_ORIGINS is not set — any website may connect. Set it to your client address in production.');
  if (!process.env.TURN_URL && !process.env.ICE_SERVERS) console.warn('[server] no TURN relay configured — live faces and voice may fail between players on different networks.');
});

// Render sends SIGTERM on every deploy and restart: close cleanly so players reconnect quickly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
