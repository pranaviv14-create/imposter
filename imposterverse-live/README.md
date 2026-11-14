# IMPOSTERVERSE LIVE

**Your face. Your character. Your secret.**

A multiplayer social-deduction game where each player's real, live face — background removed — becomes the head of a 3D character seated at a shared table. Everyone gets the same secret word except the imposter, who has to bluff.

See [REPORT.md](REPORT.md) for exactly what is implemented, what was tested and how, and what is not done.

## How a session runs

```
SESSION
  GAME 1          one secret word, one imposter
    clue round 1  every player gives exactly one clue
    clue round 2  the first speaker moves on one seat
    …             until every configured clue round is done
    discussion    once, microphones open
    vote          once, microphones muted, one private vote each
    results       the imposter, the word, every vote, the scores
  GAME 2          a new word, a newly drawn imposter
    …
FINAL SESSION LEADERBOARD   only after the last game
```

- **Two separate settings**, chosen by the host in the lobby: the number of **games** in the session, and the number of **clue rounds** in each game.
- **One imposter per game**, drawn at random. The word and the imposter stay the same for every clue round of that game.
- **The first speaker rotates** one seat every clue round, and carries on rotating across games. The server decides the order.
- **No discussion or vote between clue rounds.** Discussion starts only after the last clue round; the vote happens once, after discussion.
- **Clues are spoken.** On your turn you hold a button to talk; the table hears your real voice. When you let go, the browser offers the text of what you said, which you can correct before confirming. Typing is always available instead.
- **Voting:** click or tap the character you suspect, then confirm.
- **Scoring:** the imposter scores 1 for escaping. A tied vote convicts nobody, which counts as an escape. Scores add up across the whole session.
- **Between games** the results stay up for 20 seconds, then the next game starts by itself (the host can skip the wait). After the last game the final leaderboard appears, with game-by-game results and **Play again**, **Return to lobby** and **Leave room**.
- **Joining late:** anyone who joins during a game watches it and is dealt in when the next game starts.

## Run it on your own computer

Requires Node 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. In development the game server runs inside the same process, so that one command is everything.

To try several players on one machine, open extra tabs with `?p=2`, `?p=3`, … on the URL. Each gets its own player identity.

### Tests

```bash
npm run test:sim
```

Boots the real server and plays whole sessions with real WebSocket clients: 82 checks covering the game hierarchy, role privacy, clue order and rotation, sealed voting, ties, scoring across games, the final leaderboard, reconnection, late joiners, host transfer and voided games.

---

# Deploying: Netlify (client) + Render (game server)

The project is one repository with two parts:

| Part | What it is | Where it goes | Entry point |
|------|-----------|---------------|-------------|
| Client | React + Vite app, built to static files | **Netlify** | `index.html` → `src/main.tsx` |
| Game server | Node.js + WebSocket | **Render** | `server/index.ts` |

They find each other through two settings: the client is told the server's address (`VITE_SERVER_URL`), and the server is told which website may connect (`ALLOWED_ORIGINS`). No address is written into the code.

Do Render first, because Netlify needs the Render address.

## Before you start

1. Put this project in a GitHub repository (all files, including `netlify.toml` and `render.yaml`).
2. Have a Render account and a Netlify account, both connected to GitHub.

## Part 1 — Render (game server)

1. In Render, choose **New → Web Service** and pick the repository. (Or **New → Blueprint**, which reads `render.yaml` and fills these in for you.)
2. Enter these settings:

   | Setting | Value |
   |---------|-------|
   | Runtime / Language | **Node** |
   | Root directory | *(leave empty)* |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Health check path | `/api/health` |

3. Add environment variables (**Environment** tab):

   | Name | Value | Needed? |
   |------|-------|---------|
   | `NODE_VERSION` | `22` | Yes |
   | `ALLOWED_ORIGINS` | your Netlify address, e.g. `https://my-game.netlify.app` — add it after Part 2 | Yes, for production |
   | `TURN_URL` | from your TURN provider, e.g. `turn:turn.example.com:3478` | Strongly recommended |
   | `TURN_USERNAME` | from your TURN provider | With `TURN_URL` |
   | `TURN_CREDENTIAL` | from your TURN provider | With `TURN_URL` |

   Do **not** set `PORT`; Render provides it.

4. Deploy. When it finishes, copy the service address. It looks like `https://imposterverse-live-server.onrender.com`.
5. Check it: open that address followed by `/api/health` in a browser. You should see `{"ok":true,"rooms":0,"online":0}`.

## Part 2 — Netlify (client)

1. In Netlify, choose **Add new site → Import an existing project** and pick the same repository.
2. Netlify reads `netlify.toml`, so these should already be filled in. Confirm them:

   | Setting | Value |
   |---------|-------|
   | Base directory | *(leave empty)* |
   | Build command | `npm run build` |
   | Publish directory | `dist` |

3. Before the first deploy, add one environment variable (**Site configuration → Environment variables**):

   | Name | Value |
   |------|-------|
   | `VITE_SERVER_URL` | your Render address from Part 1, e.g. `https://imposterverse-live-server.onrender.com` |

   Use `https://`. The game turns it into the secure `wss://` socket address itself.

4. Deploy. Copy the site address, e.g. `https://my-game.netlify.app`.

## Part 3 — Connect the two

1. Go back to Render → **Environment** and set `ALLOWED_ORIGINS` to your Netlify address (no trailing slash). Save; Render restarts the server.
2. Open your Netlify address, choose **Play online**, and create a room. If a room code appears, the client and server are talking.

You can also check from your own computer:

```bash
node scripts/check-deploy.mjs https://YOUR-SERVICE.onrender.com https://YOUR-SITE.netlify.app
```

It tests the health check, that the server accepts your site and refuses others, and that a room can be created.

## If an address changes later

- **Render address changed:** update `VITE_SERVER_URL` in Netlify, then **Deploys → Trigger deploy → Deploy site**. The value is built into the site, so a new deploy is required; saving the variable alone does nothing.
- **Netlify address changed, or you added a custom domain:** update `ALLOWED_ORIGINS` in Render. Several addresses can be listed, separated by commas. `*` matches part of an address, e.g. `https://*--my-game.netlify.app` for Netlify deploy previews.

## Environment variables — full list

| Name | Where | When it is read | What it does |
|------|-------|-----------------|--------------|
| `VITE_SERVER_URL` | Netlify | At build | Address of the game server. Empty means "same address as the page" (used when one process serves both). |
| `ALLOWED_ORIGINS` | Render | At start | Websites allowed to connect. If empty, any website may connect — the server prints a warning. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Render | At start | A TURN relay for live faces and voice. |
| `ICE_SERVERS` | Render | At start | Advanced: a full ICE server list as JSON. Overrides the three `TURN_*` values. |
| `PORT` | Render | At start | Set by Render. Do not set it yourself. |
| `NODE_VERSION` | Both | At build | `22`. Netlify takes it from `netlify.toml`. |

`.env.example` lists the same variables for local use. Never commit a real `.env` file.

## Live faces and voice between different networks (TURN)

Faces and voice travel directly between players' devices (WebRTC), not through the game server. Without help, a direct connection often cannot be made when players are on different networks — typical with mobile data, university or office Wi-Fi.

- By default the game uses only public STUN servers. That is usually enough for players on the same Wi-Fi, and unreliable otherwise.
- A **TURN relay is strongly recommended** before inviting friends who are not on your network. Sign up with a TURN provider (or run your own `coturn`), and enter the three `TURN_*` values in Render.
- The credentials are never in the code or in the built site. The server hands the ICE configuration to a player's browser only when they join a room. That hand-over is unavoidable — the browser needs it to connect — so anyone in a room could read those credentials from their own browser. Use a provider account you can rotate, with a usage limit.
- **This has not been tested across different networks.** If faces or voice fail for some players, the game still works: they appear as masked characters and can type clues.

## Things to know about this hosting setup

- **Rooms live in the server's memory.** Any restart of the Render service — a new deploy, a crash, or the service going to sleep — closes all rooms. Players are shown a reconnecting banner and returned to the menu.
- **Render's free plan stops idle services** and takes a while to wake on the next visit. The first player may wait for the first room to open. Check Render's current plan details; a paid instance stays awake.
- **One server instance only.** Do not scale the Render service beyond one instance; rooms are not shared between instances.
- **Cameras and microphones need HTTPS.** Both Netlify and Render provide it automatically.
- **Speech-to-text depends on the browser.** It uses the Web Speech API: available in Chrome, Edge and Safari, not in Firefox. In most browsers the audio of each spoken clue is sent to the browser maker's service to be recognised. Where it is missing or fails, players type the clue.
- **Player reports** are written to the server log (visible in Render's Logs tab). Nothing acts on them automatically.

## Running everything on one server instead

If you would rather not split it: run `npm run build` and then `npm start` on any Node host. When a `dist/` folder exists the server also serves the client, on one address, and neither `VITE_SERVER_URL` nor `ALLOWED_ORIGINS` is needed.

---

## How it is built

```
shared/     Rules engine, word database and wire types — used by both server and client
server/     Authoritative game server (WebSocket) + optional static file server
src/
  face/     Live-face pipeline: camera → face landmarks → segmentation → packed cutout
  net/      WebSocket client with reconnection; WebRTC mesh
  media/    Camera / microphone control, speech-to-text
  three/    Characters, room, lighting, face shader
  screens/  Home, online setup, room, offline mode, menu pages
  ui/       Design-system components
  styles.css  Design tokens and every component style
scripts/    setup (MediaPipe runtime and models), simulation test, deployment check
netlify.toml, render.yaml   hosting configuration
```

### The live face, briefly

1. MediaPipe FaceLandmarker finds the face in each camera frame.
2. A smoothed square crop is taken around the head.
3. MediaPipe ImageSegmenter separates person from background on that crop; the jawline landmarks cut away neck and shoulders.
4. Colour and matte are packed side by side into one 512×256 frame, because WebRTC video has no alpha channel.
5. That packed frame is what gets streamed. Every receiver recombines it in a shader and draws it as the character's head.

All of this runs on the player's own device. The raw camera image is never sent anywhere.

### Why the server is trusted

The server holds the secret word and the roles. Each client is sent a public state plus only its own private state. Clues, votes and scores are validated and applied on the server; there is no message a client can send to change a score.

### Adding a game mode

Modes are entries in `MODES` in [shared/engine.ts](shared/engine.ts). A mode supplies `deal()` (who gets what) and `privateFor()` (what each player may see). Spy, Mafia and Double Bluff are registered as "in development" and are not playable.
