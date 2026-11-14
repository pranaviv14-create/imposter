// Checks a running game server the way a separately hosted client would reach it.
//   node scripts/check-deploy.mjs <server-url> <client-origin>
//   node scripts/check-deploy.mjs https://my-server.onrender.com https://my-game.netlify.app
//
// It verifies: the health check, cross-origin API access, that the game socket
// accepts the client's origin, that it refuses other origins (when ALLOWED_ORIGINS
// is set on the server), and that a room can be created over the socket.
import { WebSocket } from 'ws';

const [, , serverArg, originArg] = process.argv;
if (!serverArg || !originArg) {
  console.error('usage: node scripts/check-deploy.mjs <server-url> <client-origin>');
  process.exit(2);
}
const server = serverArg.replace(/\/+$/, '');
const origin = originArg.replace(/\/+$/, '');
const wsUrl = server.replace(/^http/, 'ws') + '/ws';
let failed = 0;
const report = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

function connect(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, { headers });
    const done = (result) => { clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { ws.terminate(); done({ open: false, reason: 'timeout' }); }, 15000);
    ws.on('open', () => done({ open: true, ws }));
    ws.on('unexpected-response', (_req, res) => done({ open: false, reason: 'HTTP ' + res.statusCode }));
    ws.on('error', (e) => done({ open: false, reason: e.message }));
  });
}

try {
  const health = await fetch(server + '/api/health');
  const body = await health.json().catch(() => ({}));
  report('health check answers', health.ok && body.ok === true, `${health.status} ${JSON.stringify(body)}`);
} catch (e) {
  report('health check answers', false, e.message);
}

try {
  const res = await fetch(server + '/api/presence?ids=IVTESTTEST1', { headers: { Origin: origin } });
  report('API allows the client origin (CORS)', res.headers.get('access-control-allow-origin') === origin, String(res.headers.get('access-control-allow-origin')));
} catch (e) {
  report('API allows the client origin (CORS)', false, e.message);
}

const good = await connect({ Origin: origin });
report(`game socket accepts ${origin}`, good.open, good.open ? wsUrl : good.reason);

const bad = await connect({ Origin: 'https://not-your-site.example' });
if (bad.open) {
  bad.ws.terminate();
  report('game socket refuses other websites', false, 'ALLOWED_ORIGINS is not set on the server, so any site can connect');
} else {
  report('game socket refuses other websites', true, bad.reason);
}

if (good.open) {
  const created = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    good.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'state') { clearTimeout(timer); resolve(m.pub); }
    });
    good.ws.send(JSON.stringify({ t: 'create', playerId: 'deploycheck_' + Date.now(), name: 'Check', look: { body: 'tailor', palette: 0, accessory: 'none', enhance: false } }));
  });
  report('a room can be created over the socket', !!created && /^[A-Z]{5}$/.test(created.code), created ? `room ${created.code}, ${created.settings.games} games x ${created.settings.rounds} clue rounds` : 'no reply');
  good.ws.send(JSON.stringify({ t: 'leave' }));
  good.ws.close();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
