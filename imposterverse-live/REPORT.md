# Implementation report

Written 14 November 2026. This says what exists, how each claim was checked, and what is missing. "Tested" means I ran it and saw the result; where the test had a limitation, it is stated.

## How things were tested

- **Simulation** — `npm run test:sim`: the real server with real WebSocket clients, 51 assertions, all passing.
- **Browser** — three separate browser tabs acting as three players on one laptop (Chromium, Intel Iris Xe), driving the real UI.
- **Stand-in camera** — the test browser blocks real cameras. To exercise the face pipeline I replaced the camera feed with a moving portrait photograph on a striped background. Everything downstream of the camera ran for real. **No real webcam and no real phone has been tested.**

## Acceptance tests

| # | Item | Status | Evidence and limits |
|---|------|--------|---------------------|
| 1 | New branding | Implemented and tested | New mark, wordmark, palette, type and icon; viewed on every main screen. |
| 2 | Functional home screen | Implemented and tested | All seven destinations open. Viewed at desktop and phone width. |
| 3 | Room creation | Implemented and tested | Simulation and browser. |
| 4 | Joining from separate devices | Implemented but not fully tested | Separate tabs and separate WebSocket clients join by code and by invite link. Physically separate devices over a real network: not tested. |
| 5 | Live camera permissions | Implemented but not fully tested | Camera is off until asked for; denial and missing-camera messages are coded. The real permission prompt could not be exercised here. |
| 6 | Real-time face segmentation | Implemented but not fully tested | Ran on the stand-in feed: face tracked, striped background removed, hair kept. About 45 ms per frame on the test laptop while three 3D scenes were running. Real faces, lighting and phones: not tested. |
| 7 | Live face compositing onto character bodies | Implemented but not fully tested | Seen working with the stand-in feed in the room and through a full round. Same limit as item 6. |
| 8 | Live character visible to other players | Implemented but not fully tested | A second tab received the cutout stream over WebRTC (connected, 384×192, playing). I did not capture a picture of the composited result on the receiving side. Different networks / TURN: not tested. |
| 9 | Camera-off fallback | Implemented and tested | Mask character shown for every player without a camera. |
| 10 | Secret role assignment | Implemented and tested | Simulation; and in the browser, three tabs showed one imposter and two matching words. |
| 11 | Correct clue order | Implemented and tested | Simulation asserts order; out-of-turn and duplicate clues rejected. Seen in browser. |
| 12 | Discussion stage | Implemented and tested | Timer, host skip, chat and reactions seen in browser. Voice: see below. |
| 13 | Voting by all eligible players | Implemented and tested | Simulation and browser. Self-votes, double votes and spectator votes rejected. |
| 14 | Secure result reveal | Implemented and tested | Simulation asserts nothing about roles or votes is sent before voting ends; host cannot force an early result. |
| 15 | Correct scoring | Implemented and tested | Caught → 0 for everyone; escaped → imposter +1 only; tie → nobody convicted. Both outcomes also seen in browser. |
| 16 | Offline pass-the-phone mode | Implemented and tested | Full round clicked through at phone width: face-down cards, hold to reveal, sealed ballots, verdict, scores. Running with the network actually disconnected (service worker): not tested. |
| 17 | Reconnection | Implemented and tested | Simulation (seat token, wrong token rejected, same word returned) and browser reload mid-game. |
| 18 | Responsive mobile interface | Implemented but not fully tested | Home, modes, offline flow and the room viewed at 375×812 with no horizontal overflow. Emulated viewport only; no real phone, no tablet size, no iOS Safari. |
| 19 | Functional navigation | Implemented and tested | Every screen reached and exited. |
| 20 | Secure backend configuration | Implemented but not fully tested | Server-side validation is covered by the simulation. TURN credentials come from environment variables. No penetration testing, no production deployment, no load test. |

## Not implemented

- **Firebase (Auth, Realtime Database, Cloud Functions).** Not used. No Firebase project was supplied, so I built a Node WebSocket server that holds the trusted game logic instead. Consequence: there are no accounts.
- **Accounts and server-side profiles.** Username, stats, XP, friends and portrait are stored in the browser only. They do not follow a player to another device, and a player could edit their own local stats.
- **Public matchmaking.** Private rooms only.
- **Who Is The Spy, Mafia, Double Bluff.** Listed as "in development"; not playable.
- **Real friend system.** The friends list is local. Online status is shown, but there is no friend request, no direct invite to a friend's device, and no server-side block list.
- **Moderation back office.** Reports are appended to a `reports.jsonl` file on the server. Nothing reads or acts on them.
- **3D facial tracking.** The face is a flat live cutout that always faces the viewer. It is not mapped onto 3D head geometry.

## Implemented but never exercised

- **Voice chat and the speaking indicator.** The microphone path and voice-activity meter are written; no microphone was available to test them.
- **Camera device switching and automatic recovery** after the camera is unplugged or taken by another app.
- **Low-data mode and the lite (landmark-only) cutout.**
- **Rooms larger than five players** in the browser. The simulation covers five.
- **Host kick and manual host transfer** from the UI. Automatic host transfer is tested.
- **Unlockable cosmetics.** Levels gate characters, colourways and accessories; I did not play enough rounds to see an unlock.

## Known issues

- **Slow first frame.** Each time a 3D screen opens, it takes a noticeable moment before the scene appears, while shaders compile. I could not measure this properly because the test browser was throttling rendering. It should be measured on real devices; the likely fix is one persistent 3D canvas shared across screens.
- **Performance on phones is unknown.** The scene uses physically based materials, shadows and image-based lighting. There is a lighter path (Settings → Graphics quality, or automatic on weak phones), but none of it has run on a phone.
- **Mesh video does not scale far.** Every player sends their cutout to every other player. This should be fine for a table of six to eight; ten on mobile data is unproven.
- **Phone: a three-line seat label can tuck under the leave button.** On a phone, the top-left player's status tag (for example "Wrongly accused") can slide partly under the leave button when a clue and a tag are both showing.
- **Friends, Settings, How to play and Legal were checked by content, not by eye,** after the redesign: they render with the new fonts and components, but I did not get a screenshot of them.
- **A raised hat can overlap big hair.** Top hat, halo and crown sit at a fixed height above the live face.
- **The privacy policy and terms are a plain-language template**, not legal documents.

## What changed in the visual overhaul

- **Typography:** replaced the uppercase serif system with Bricolage Grotesque for display and Plus Jakarta Sans for text. Sentence case throughout; uppercase is used only for small labels.
- **Colour:** replaced black and gold with ink plum, cream, and four accents with fixed meanings.
- **Components:** rebuilt buttons, inputs, steppers, toggles, cards, sheets, tabs, role card, clue rows, ballot, verdict and toasts.
- **Home:** two clear primary actions and five compact destinations instead of a seven-item list.
- **Characters:** re-modelled. Lathe-turned torso with a shoulder line, clothing panels fitted to the body surface, arms with elbows and mitten hands, fabric and vinyl materials, and a visor-mask head with blinking eyes and per-character headgear for players without a camera.
- **Room:** halo light, lacquer table with a status light strip, tub chairs, lit arches, rug, reflections.
- **Phone layout:** the phase title moves into the panel so seat labels have room; labels are kept on screen.

## Game hierarchy and deployment preparation (15 November 2026)

### The hierarchy was wrong, and is now fixed

The previous version had it backwards: a "game" was several rounds that each had their own word, imposter and vote. It now follows the specified structure, on the server and in the UI:

SESSION → GAMES → CLUE ROUNDS → DISCUSSION → VOTING → RESULTS, then the final session leaderboard after the last game.

| Rule | Status | Evidence |
|------|--------|----------|
| Host sets games and clue rounds as two separate settings | Tested | Simulation; browser (2 games, 3 clue rounds chosen, seen by all three players) |
| Exactly one imposter per game, same word for everyone else | Tested | Simulation; browser |
| Word and imposter fixed for all clue rounds of a game | Tested | Simulation asserts every player's role and word are unchanged across rounds |
| Every player gives exactly one clue per clue round | Tested | Simulation counts clues per round; browser showed 3 + 3 + 3 |
| No second clue in a round | Tested | Simulation: out-of-turn and repeat clues rejected |
| First speaker rotates after every clue round | Tested | Simulation; browser: Asha, then Bruno, then Chloe |
| No discussion or voting between clue rounds | Tested | Simulation; browser phase log went roles → clue round 1 → 2 → 3 → discussion → vote → results |
| Discussion only after the last clue round | Tested | Simulation asserts all 9 clues are in when discussion starts |
| Voting exactly once per game | Tested | Simulation asserts the exact phase sequence |
| Next game: new word, newly drawn imposter | Tested | Simulation; browser (Router/Bruno, then Carpet/Chloe) |
| Next game starts by itself | Tested | Simulation with a short timer; browser (started 18 s after results) |
| Scores carry across games | Tested | Simulation: session score equals the sum of each game's points |
| Final leaderboard only after the last game's results | Tested | Simulation; browser |
| Game-by-game results on the final leaderboard | Tested | Browser: word, imposter, outcome and points per game |
| Play again starts a fresh session with the same settings | Tested | Simulation |
| Return to lobby | Tested | Simulation |
| Leave room | Not re-tested this pass | Button present; the underlying leave path is covered by the simulation |

Mandatory case — 3 players, 2 games, 3 clue rounds per game: run in the simulation (all nine listed points are individual checks) and once through the real UI in three browser tabs, on the split client/server setup described below.

**Decisions made where the instructions left a choice**

- The first speaker keeps rotating across games rather than restarting, so the same person does not open every game.
- "Automatically prepare the next game" is a 20-second results screen, then the next game starts. The host can skip the wait.
- A player who joins during a game is dealt in at the start of the next game (not the next session).
- Clue rounds per game can be 1–6, games per session 1–10. Defaults are 3 games of 2 clue rounds.
- "One word per clue" remains a prompt, not an enforced rule: clues up to 40 characters are accepted.

The simulation now has 82 checks. Checks about the previous (incorrect) round structure were replaced, not kept.

### Deployment preparation — what was done and tested

Nothing has been deployed. I have no access to your GitHub, Netlify or Render accounts, and this project is not in a git repository yet.

| Check | Status | Evidence and limits |
|-------|--------|---------------------|
| Install, TypeScript and production build | Tested | `npm run build` succeeds |
| Automated simulation | Tested | 82 of 82 |
| Server starts in server-only mode (as on Render) | Tested | Started with no `dist/`: answered `/` and `/api/health`, listening on `0.0.0.0`, using `PORT` |
| Client built with `VITE_SERVER_URL` connects to a server on another address | Tested | Static client on port 4173, server on port 8791; room created and a full session played |
| No address hard-coded | Tested | The default build contains no `localhost`; the address comes only from `VITE_SERVER_URL` |
| Origin validation | Tested | Allowed origin connected; a foreign origin and a missing origin got HTTP 403 |
| Cross-origin API (friends' online status) | Tested | CORS header returned for the allowed origin |
| Rooms, joining, roles, clue rounds, vote, scoring, next game | Tested | On the split setup, in the browser |
| Reconnection | Tested | Simulation; not repeated on the split setup |
| Secure WebSocket (`wss://`) | **Not tested** | Local test used plain `ws://`. The address conversion is one line (`https` → `wss`), but no real TLS endpoint was available |
| Netlify build and SPA redirect | **Not tested** | `netlify.toml` is written from the real build command and output folder; it has not been run by Netlify. The app has no path-based routes, so the redirect only matters for mistyped URLs |
| Render blueprint | **Not tested** | `render.yaml` is written from the real commands; it has not been run by Render |
| Service worker (offline caching) | **Not tested** | Registration failed in the test browser, which appears not to support service workers. The app carries on without it |
| Real camera, microphone, speech-to-text | **Not tested** | Blocked in the test browser |
| WebRTC between different networks, TURN | **Not tested** | No second network, no TURN account |

### Blockers before inviting friends

1. The code must be in a GitHub repository, then deployed (see README).
2. Without a TURN relay, faces and voice are likely to fail for friends on other networks. The game still plays without them.
3. Nobody has yet used this with a real camera or microphone. Try it with one other person on a different network before a group.
4. On Render's free plan the server sleeps when idle and loses all rooms when it restarts.

## Voice, clue turn and click-to-vote (15 November 2026)

Still as built in the previous pass, and still with the same limit: **the test browser blocks the microphone and camera, so nothing involving a real voice has been run.**

- Clues are push-to-talk: the table hears the speaker only while they hold the button. Not tested with audio.
- Speech-to-text uses the browser's Web Speech API and offers the text for the speaker to correct and confirm. Not tested; unavailable in Firefox; in most browsers the audio of the clue goes to the browser maker. Disclosed on the privacy page.
- Microphones: clue turn = speaker only, discussion = open, vote = muted. Enforced on players' devices (sender gate and receiver mute), not by the server. Not tested with audio.
- Typing a clue instead of speaking: tested, and is how every browser test here was played.
- Voting by clicking a 3D character: tested with a real mouse click. Other ballots were cast through the name labels.

## Polish pass (15 November 2026)

Refinement only: palette, type, layout and logo are unchanged.

- **Characters:** heads turn toward whoever is speaking and glance around otherwise; each emote plays a different body reaction (laugh, gasp, think, sus, clap, heart); mask eyes blink and change with the moment; each character has its own resting expression and extra outfit details. Win, lose and caught each have their own pose.
- **Room:** sharper shadows, a light shaft and glow under the halo, an uplight from the table strip, contact shadows, a second rim light, and a flare when the verdict lands. The light breathes during the vote.
- **Staging:** a title card as each phase begins, a different camera for roles, discussion and voting, a camera jolt on the reveal, and a personal result line under the verdict.
- **Interaction:** hover, press and entrance motion on buttons, cards, lists, tabs, toggles, links and the secret card.
- **Home:** the duplicate LIVE badge above the title is removed; the table now cycles speakers and reactions.
- **Phone:** seat labels stay clear of the leave button.

Checked: typecheck, build and the 51 simulation checks pass; a three-tab round ran with no console errors and the title cards, vote mood and result sequence were seen. Not seen: the emote reactions and idle motion in motion (the test window was hidden, so the browser was not drawing frames), and the phone layout after this pass. The face pipeline code was not touched; stepped by hand it still tracked and segmented the stand-in feed, but I did not get a picture of the composite this time. All motion is disabled when reduced motion is on.

Game rules, networking and the face pipeline were not changed by the overhaul, apart from a slightly larger head crop so wide hair is not clipped.
