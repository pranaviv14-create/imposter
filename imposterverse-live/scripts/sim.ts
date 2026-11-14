// End-to-end simulation: boots the real game server and plays whole sessions
// with real WebSocket clients, asserting the rules, privacy and reliability claims.
//   npm run test:sim
//
// The hierarchy under test:
//   SESSION -> GAMES -> CLUE ROUNDS -> DISCUSSION -> VOTING -> RESULTS
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer, type GameServerOptions } from '../server/game';
import type { ClientMsg, PrivateState, PublicState, ServerMsg } from '../shared/types';
import { tallyVotes, scoreRound, pickWord } from '../shared/engine';
import { CATEGORIES } from '../shared/words';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const look = { body: 'tailor', palette: 0, accessory: 'none', enhance: false };

class Bot {
  ws!: WebSocket;
  pub: PublicState | null = null;
  priv: PrivateState | null = null;
  token = '';
  errors: string[] = [];
  raw: string[] = [];
  left: string | null = null;
  /** Every phase change this client saw, as "game:phase". */
  phases: string[] = [];
  constructor(public url: string, public id: string, public name: string) {}
  open() {
    return new Promise<void>((resolve) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => resolve());
      this.ws.on('message', (d) => {
        const text = d.toString();
        this.raw.push(text);
        const m = JSON.parse(text) as ServerMsg;
        if (m.t === 'state') {
          const tag = `${m.pub.game}:${m.pub.phase}`;
          if (this.phases[this.phases.length - 1] !== tag) this.phases.push(tag);
          this.pub = m.pub;
          this.priv = m.priv;
        } else if (m.t === 'joined') this.token = m.token;
        else if (m.t === 'error') this.errors.push(m.message);
        else if (m.t === 'left') this.left = m.reason;
      });
    });
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: () => boolean, label: string, ms = 4000) {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for: ' + label + ' (' + this.name + ')');
      await sleep(10);
    }
  }
  async expectError(fn: () => void, label: string) {
    const n = this.errors.length;
    fn();
    try {
      await this.until(() => this.errors.length > n, label, 800);
      return true;
    } catch {
      return false;
    }
  }
}

async function boot(options: GameServerOptions) {
  const server = http.createServer();
  attachGameServer(server, { quiet: true, reportFile: null, ...options });
  await new Promise<void>((r) => server.listen(0, r));
  const url = `ws://localhost:${(server.address() as any).port}/ws`;
  let n = 0;
  const mk = async (name?: string) => {
    n += 1;
    const b = new Bot(url, `player_${n}_${Math.random().toString(36).slice(2, 8)}`, name ?? `P${n}`);
    await b.open();
    return b;
  };
  return { server, url, mk };
}

async function main() {
  console.log('\nEngine unit checks');
  {
    const t = tallyVotes({ a: ['c'], b: ['c'], c: ['a'], d: ['c'] }, ['a', 'b', 'c', 'd'], 1);
    check('majority vote accuses the most-voted player', t.accusedIds.join() === 'c');
    const tie = tallyVotes({ a: ['b'], b: ['a'], c: ['a'], d: ['b'] }, ['a', 'b', 'c', 'd'], 1);
    check('a tie for first place accuses nobody', tie.accusedIds.length === 0);
    const none = tallyVotes({ a: [], b: [] }, ['a', 'b', 'c'], 1);
    check('no votes accuses nobody', none.accusedIds.length === 0);
    const s1 = scoreRound('classic', ['a', 'b', 'c'], ['c'], ['c']);
    check('classic: caught imposter scores 0, crew scores 0', s1.outcome === 'caught' && Object.values(s1.scoreDelta).every((v) => v === 0));
    const s2 = scoreRound('classic', ['a', 'b', 'c'], ['c'], ['a']);
    check('classic: escaped imposter scores exactly 1, crew 0', s2.outcome === 'escaped' && s2.scoreDelta.c === 1 && s2.scoreDelta.a === 0 && s2.scoreDelta.b === 0);
    const used = new Set<string>();
    const seen = new Set<string>();
    const size = CATEGORIES.find((c) => c.id === 'food')!.words.length;
    for (let i = 0; i < size; i++) seen.add(pickWord('food', used).word);
    check(`no word repeats until a category is exhausted (${size} draws)`, seen.size === size);
  }

  // ==================================================================
  // PART A — rooms, privacy, validation, reconnection (one clue round per game)
  // ==================================================================
  const A = await boot({ rolesMs: 400, gameGraceMs: 1500, lobbyGraceMs: 400, hostGraceMs: 150, offlineTurnMs: 200, nextMs: 60000 });
  const mk = (i?: string) => A.mk(i);

  console.log('\nRoom creation and joining');
  const bots = [await mk(), await mk(), await mk(), await mk()];
  const [host, b2, b3, b4] = bots;
  host.send({ t: 'create', playerId: host.id, name: 'P1', look, settings: { games: 10, rounds: 1, discussionSeconds: 15, votingSeconds: 15, clueSeconds: 10 } });
  await host.until(() => !!host.pub, 'room created');
  const code = host.pub!.code;
  check('room code generated', /^[A-Z]{5}$/.test(code), code);
  check('creator is host', host.pub!.players[0].isHost);
  check('joining a wrong code is rejected', await b2.expectError(() => b2.send({ t: 'join', code: 'ZZZZZ', playerId: b2.id, name: 'P2', look }), 'bad code'));
  for (const b of [b2, b3, b4]) b.send({ t: 'join', code, playerId: b.id, name: b.name, look });
  await host.until(() => host.pub!.players.length === 4, '4 players');
  check('four separate clients joined the same room', host.pub!.players.length === 4);
  const impersonator = await mk();
  check('a second client cannot take an occupied seat without its token', await impersonator.expectError(() => impersonator.send({ t: 'join', code, playerId: b2.id, name: 'X', look }), 'seat theft'));
  check('non-host cannot start the game', await b2.expectError(() => b2.send({ t: 'start' }), 'non-host start'));
  check('non-host cannot change rules', await b3.expectError(() => b3.send({ t: 'settings', settings: { games: 2 } }), 'non-host settings'));

  const deal = async (first: boolean) => {
    host.send(first ? { t: 'start' } : { t: 'next' });
    await host.until(() => host.pub!.phase === 'roles', 'roles phase');
    await Promise.all(bots.map((b) => b.until(() => b.pub!.phase === 'roles' && b.priv!.role !== 'spectator', 'role dealt')));
    return { imposters: bots.filter((b) => b.priv!.role === 'imposter'), crew: bots.filter((b) => b.priv!.role === 'crew') };
  };

  console.log('\nGame 1 — roles, clues, voting, results (imposter caught)');
  let r = await deal(true);
  check('exactly one imposter is assigned', r.imposters.length === 1 && r.crew.length === 3);
  const word = r.crew[0].priv!.word!;
  check('all normal players share the same secret word', r.crew.every((b) => b.priv!.word === word) && !!word);
  check('the imposter receives no word, only an instruction', r.imposters[0].priv!.word === null && /imposter/i.test(r.imposters[0].priv!.instruction));
  check('the secret word never appears in anything sent to the imposter', !r.imposters[0].raw.some((x) => x.includes(`"${word}"`)));
  check('public state exposes no roles and no reveal before voting ends', bots.every((b) => b.pub!.reveal === null && !JSON.stringify(b.pub).includes('imposterIds')));

  for (const b of bots) b.send({ t: 'seen' });
  await host.until(() => host.pub!.phase === 'clue', 'clue phase');
  const order = host.pub!.roundOrder.slice();
  check('the speaking order contains every player once', order.length === 4 && new Set(order).size === 4);
  const byId = (id: string) => bots.find((b) => b.id === id)!;
  const outOfTurn = byId(order[2]);
  check('out-of-turn clue is rejected', await outOfTurn.expectError(() => outOfTurn.send({ t: 'clue', text: 'sneaky' }), 'out of turn'));
  for (let i = 0; i < order.length; i++) {
    const b = byId(order[i]);
    await b.until(() => b.pub!.currentId === b.id, 'my turn');
    b.send({ t: 'clue', text: `clue${i}` });
    b.send({ t: 'clue', text: `dupe${i}` }); // duplicate submission in the same breath
  }
  await host.until(() => host.pub!.phase === 'discussion', 'discussion phase');
  check('clues are recorded in the exact speaking order', host.pub!.clues.map((c) => c.playerId).join() === order.join());
  check('duplicate clue submissions are ignored', host.pub!.clues.length === 4 && host.pub!.clues.every((c) => c.text.startsWith('clue')));
  check('discussion stage has a countdown', (host.pub!.phaseEndsAt ?? 0) > Date.now());
  check('non-host cannot skip discussion', await b2.expectError(() => b2.send({ t: 'advance' }), 'non-host advance'));
  host.send({ t: 'advance' });
  await host.until(() => host.pub!.phase === 'voting', 'voting phase');
  check('host cannot force voting to end early', await host.expectError(() => host.send({ t: 'advance' }), 'advance in voting'));

  const imp = r.imposters[0];
  const v0 = r.crew[0];
  check('self-vote is rejected', await v0.expectError(() => v0.send({ t: 'vote', targets: [v0.id] }), 'self vote'));
  check('voting for more than one player is rejected', await v0.expectError(() => v0.send({ t: 'vote', targets: [imp.id, r.crew[1].id] }), 'over limit'));
  v0.send({ t: 'vote', targets: [imp.id] });
  await host.until(() => host.pub!.votedIds.includes(v0.id), 'first vote counted');
  check('duplicate vote is rejected', await v0.expectError(() => v0.send({ t: 'vote', targets: [r.crew[1].id] }), 'dup vote'));
  check('votes stay hidden while voting is open (only who has voted is shown)', host.pub!.reveal === null && host.pub!.phase === 'voting' && !JSON.stringify(host.pub).includes('"votes"'));
  check('voting completion status is published', host.pub!.votedIds.length === 1);
  r.crew[1].send({ t: 'vote', targets: [imp.id] });
  r.crew[2].send({ t: 'vote', targets: [imp.id] });
  await sleep(150);
  check('results are not revealed until every eligible player has voted', host.pub!.phase === 'voting' && host.pub!.reveal === null);
  imp.send({ t: 'vote', targets: [v0.id] });
  await host.until(() => host.pub!.phase === 'reveal', 'reveal');
  const rev = host.pub!.reveal!;
  check('IMPOSTER CAUGHT when the majority votes for the imposter', rev.outcome === 'caught' && rev.caughtIds[0] === imp.id);
  check('results show the word, roles and who voted for whom', rev.word === word && rev.imposterIds[0] === imp.id && rev.votes[v0.id][0] === imp.id && rev.votes[imp.id][0] === v0.id);
  check('caught imposter scores 0 and crew score 0', host.pub!.players.every((p) => p.score === 0));

  console.log('\nGame 2 — imposter escapes, scoring, a new word');
  r = await deal(false);
  check('the game counter advanced', host.pub!.game === 2);
  check('the new game has a different word', r.crew[0].priv!.word !== word);
  host.send({ t: 'advance' }); // host override of the role-reveal wait
  await host.until(() => host.pub!.phase === 'clue', 'clue 2');
  for (const id of host.pub!.roundOrder.slice()) {
    const b = byId(id);
    await b.until(() => b.pub!.currentId === b.id, 'turn g2');
    b.send({ t: 'clue', text: 'x' });
  }
  await host.until(() => host.pub!.phase === 'discussion', 'discussion 2');
  host.send({ t: 'advance' });
  await host.until(() => host.pub!.phase === 'voting', 'voting 2');
  const imp2 = r.imposters[0];
  const scapegoat = r.crew[0];
  for (const b of bots) b.send({ t: 'vote', targets: [b === scapegoat ? r.crew[1].id : scapegoat.id] });
  await host.until(() => host.pub!.phase === 'reveal', 'reveal 2');
  check('THE IMPOSTER ESCAPED when a normal player is voted out', host.pub!.reveal!.outcome === 'escaped');
  const scores = Object.fromEntries(host.pub!.players.map((p) => [p.id, p.score]));
  check('escaped imposter gains exactly one point; nobody else scores', scores[imp2.id] === 1 && Object.values(scores).reduce((a, b) => a + b, 0) === 1);
  imp2.ws.send(JSON.stringify({ t: 'score', id: imp2.id, score: 99 }));
  await sleep(100);
  check('a forged score message changes nothing', host.pub!.players.find((p) => p.id === imp2.id)!.score === 1);

  console.log('\nGame 3 — reconnection, late join, tie vote');
  r = await deal(false);
  const late = await mk('Late');
  late.send({ t: 'join', code, playerId: late.id, name: 'Late', look });
  await late.until(() => !!late.priv, 'late joined');
  check('late joiner waits as a spectator with no secret information', late.priv!.role === 'spectator' && late.priv!.word === null && late.pub!.players.find((p) => p.id === late.id)!.waiting);
  check('late joiner is not in the speaking order', !late.pub!.roundOrder.includes(late.id));

  const dropper = r.crew.find((b) => b !== host)!;
  const dropWord = dropper.priv!.word;
  const dropToken = dropper.token;
  dropper.ws.close();
  await host.until(() => host.pub!.players.find((p) => p.id === dropper.id)?.connected === false, 'drop seen');
  check('disconnected player is shown as offline but keeps their seat', host.pub!.players.some((p) => p.id === dropper.id));
  const thief = await mk();
  check('reconnecting with a wrong token is rejected', await thief.expectError(() => thief.send({ t: 'join', code, playerId: dropper.id, token: 'nope', name: 'x', look }), 'bad token'));
  const back = new Bot(A.url, dropper.id, dropper.name);
  await back.open();
  back.send({ t: 'join', code, playerId: dropper.id, token: dropToken, name: dropper.name, look });
  await back.until(() => !!back.priv && back.priv.role === 'crew', 'rejoined');
  check('reconnected player gets their seat and the same secret word back', back.priv!.word === dropWord && host.pub!.players.find((p) => p.id === dropper.id)!.connected);
  bots[bots.indexOf(dropper)] = back;
  const crew3 = r.crew.map((b) => (b === dropper ? back : b));

  for (const b of bots) b.send({ t: 'seen' });
  await host.until(() => host.pub!.phase === 'clue', 'clue 3');
  for (const id of host.pub!.roundOrder.slice()) {
    const b = bots.find((x) => x.id === id)!;
    await b.until(() => b.pub!.currentId === b.id, 'turn g3');
    b.send({ t: 'clue', text: 'y' });
  }
  await host.until(() => host.pub!.phase === 'discussion', 'discussion 3');
  host.send({ t: 'advance' });
  await host.until(() => host.pub!.phase === 'voting', 'voting 3');
  check('a spectator cannot vote', await late.expectError(() => late.send({ t: 'vote', targets: [host.id] }), 'spectator vote'));
  const imp3 = r.imposters[0];
  crew3[0].send({ t: 'vote', targets: [imp3.id] });
  crew3[1].send({ t: 'vote', targets: [imp3.id] });
  crew3[2].send({ t: 'vote', targets: [crew3[0].id] });
  imp3.send({ t: 'vote', targets: [crew3[0].id] });
  await host.until(() => host.pub!.phase === 'reveal', 'reveal 3');
  check('a tied vote convicts nobody, so the imposter escapes', host.pub!.reveal!.outcome === 'escaped' && host.pub!.reveal!.accusedIds.length === 0);
  check('the result is flagged as a tie', host.pub!.reveal!.tie === true);

  console.log('\nGame 4 — late joiner dealt in, absent player skipped, host transfer, mid-game leave');
  host.send({ t: 'next' });
  await late.until(() => late.pub!.phase === 'roles' && late.priv!.role !== 'spectator', 'late dealt in');
  check('a late joiner is dealt in when the next game starts', late.pub!.order.includes(late.id) && late.pub!.seatOrder.includes(late.id));
  const all = [...bots, late];
  host.send({ t: 'advance' });
  await host.until(() => host.pub!.phase === 'clue', 'clue 4');
  const cur = all.find((b) => b.id === host.pub!.currentId)!;
  const observer = all.find((b) => b !== cur)!;
  const wasHost = cur === host;
  cur.ws.close();
  await observer.until(() => observer.pub!.clues.length >= 1, 'absent turn skipped', 3000);
  check('an absent player’s turn is passed automatically', observer.pub!.clues[0].playerId === cur.id && observer.pub!.clues[0].text === '');
  if (!wasHost) host.ws.close();
  await observer.until(() => observer.pub!.players.some((p) => p.isHost && p.connected), 'host transferred', 3000);
  check('host role transfers when the host disconnects', observer.pub!.players.filter((p) => p.isHost).length === 1 && observer.pub!.players.find((p) => p.isHost)!.connected);
  const alive = all.filter((b) => b.ws.readyState === WebSocket.OPEN);
  const impNow = alive.find((b) => b.priv!.role === 'imposter');
  if (impNow) {
    impNow.send({ t: 'leave' });
    const other = alive.find((b) => b !== impNow)!;
    await other.until(() => other.pub!.phase === 'reveal', 'void reveal', 3000);
    check('a game is voided (no scoring) when the imposter leaves mid-game', other.pub!.reveal!.outcome === 'void');
  } else {
    const other = alive[0];
    await other.until(() => other.pub!.phase === 'reveal', 'void reveal after grace', 6000);
    check('a game is voided (no scoring) when the imposter leaves mid-game', other.pub!.reveal!.outcome === 'void');
  }
  for (const b of [...all, impersonator, thief]) b.ws.terminate();
  A.server.close();

  // ==================================================================
  // PART B — the mandatory hierarchy check: 3 players, 2 games, 3 clue rounds per game
  // ==================================================================
  console.log('\nHierarchy — 3 players, 2 games, 3 clue rounds per game');
  const B = await boot({ rolesMs: 5000, nextMs: 60000 });
  const m = [await B.mk('Asha'), await B.mk('Bruno'), await B.mk('Chloe')];
  const [mh, m2, m3] = m;
  mh.send({ t: 'create', playerId: mh.id, name: 'Asha', look, settings: { games: 2, rounds: 3, discussionSeconds: 15, votingSeconds: 15, clueSeconds: 10 } });
  await mh.until(() => !!mh.pub, 'session room');
  const mcode = mh.pub!.code;
  m2.send({ t: 'join', code: mcode, playerId: m2.id, name: 'Bruno', look });
  m3.send({ t: 'join', code: mcode, playerId: m3.id, name: 'Chloe', look });
  await mh.until(() => mh.pub!.players.length === 3, 'three at the table');
  await m3.until(() => !!m3.pub && m3.pub.players.length === 3, 'm3 synced');
  check('games and clue rounds are two separate settings, seen by every player', m3.pub!.settings.games === 2 && m3.pub!.settings.rounds === 3 && m2.pub!.settings.games === 2 && m2.pub!.settings.rounds === 3);
  const seats = mh.pub!.players.map((p) => p.id);
  const mById = (id: string) => m.find((b) => b.id === id)!;

  /** Plays one whole game and records everything the hierarchy rules are about. */
  const playGame = async (vote: (voter: Bot, imposter: Bot) => string) => {
    await mh.until(() => mh.pub!.phase === 'roles', 'roles');
    await Promise.all(m.map((b) => b.until(() => b.pub!.phase === 'roles' && b.priv!.role !== 'spectator', 'dealt')));
    const game = mh.pub!.game;
    const imposter = m.find((b) => b.priv!.role === 'imposter')!;
    const dealt = m.map((b) => ({ role: b.priv!.role, word: b.priv!.word }));
    for (const b of m) b.send({ t: 'seen' });
    await mh.until(() => mh.pub!.phase === 'clue', 'clue');
    const starters: string[] = [];
    const orders: string[][] = [];
    let stable = true;
    let leakedPhase = false;
    for (let round = 1; round <= mh.pub!.settings.rounds; round++) {
      await mh.until(() => mh.pub!.phase === 'clue' && mh.pub!.round === round, `clue round ${round}`);
      starters.push(mh.pub!.starterId!);
      const ro = mh.pub!.roundOrder.slice();
      orders.push(ro);
      for (const id of ro) {
        const b = mById(id);
        await b.until(() => b.pub!.currentId === b.id && b.pub!.round === round, 'turn');
        // Between and during clue rounds the only phase is "clue": no discussion, no vote.
        if (mh.pub!.phase !== 'clue' || mh.pub!.reveal) leakedPhase = true;
        // The word and role do not change from one clue round to the next.
        m.forEach((x, i) => { if (x.priv!.role !== dealt[i].role || x.priv!.word !== dealt[i].word) stable = false; });
        b.send({ t: 'clue', text: `g${game}r${round}` });
      }
    }
    await mh.until(() => mh.pub!.phase === 'discussion', 'discussion');
    const cluesAtDiscussion = mh.pub!.clues.slice();
    mh.send({ t: 'advance' });
    await mh.until(() => mh.pub!.phase === 'voting', 'voting');
    for (const b of m) b.send({ t: 'vote', targets: [vote(b, imposter)] });
    await mh.until(() => mh.pub!.phase === 'reveal', 'results');
    return { game, imposter, word: mh.pub!.reveal!.word, starters, orders, stable, leakedPhase, cluesAtDiscussion, reveal: mh.pub!.reveal! };
  };

  mh.send({ t: 'start' });
  // Game 1: the crew catch the imposter.
  const g1 = await playGame((voter, imp) => (voter === imp ? m.find((b) => b !== imp)!.id : imp.id));

  const perRound = (clues: { playerId: string; round: number }[], round: number) => clues.filter((c) => c.round === round).map((c) => c.playerId);
  check('1. all three players give exactly one clue in clue round 1', perRound(g1.cluesAtDiscussion, 1).length === 3 && new Set(perRound(g1.cluesAtDiscussion, 1)).size === 3);
  check('   …and exactly one each in clue rounds 2 and 3', [2, 3].every((r) => perRound(g1.cluesAtDiscussion, r).length === 3 && new Set(perRound(g1.cluesAtDiscussion, r)).size === 3));
  check('2. the first speaker rotates: seat 1, then seat 2, then seat 3', g1.starters.join() === [seats[0], seats[1], seats[2]].join(), g1.starters.join());
  check('   …and each clue round runs in seat order from its first speaker', g1.orders[1].join() === [seats[1], seats[2], seats[0]].join() && g1.orders[2].join() === [seats[2], seats[0], seats[1]].join());
  check('   clues were recorded in exactly that order', g1.cluesAtDiscussion.map((c) => c.playerId).join() === g1.orders.flat().join());
  check('3. no discussion or voting appears between clue rounds', !g1.leakedPhase);
  check('   the word and the imposter stay the same through all clue rounds', g1.stable);
  check('4. discussion starts only after clue round 3 (all 9 clues are in)', g1.cluesAtDiscussion.length === 9);
  const game1Phases = mh.phases.filter((p) => p.startsWith('1:')).join(' > ');
  check('5. voting happens exactly once, after discussion', game1Phases === '1:roles > 1:clue > 1:discussion > 1:voting > 1:reveal', game1Phases);
  check('6. game 1 results appear, with the word and the imposter', mh.pub!.phase === 'reveal' && g1.reveal.outcome === 'caught' && g1.reveal.imposterIds[0] === g1.imposter.id && !!g1.reveal.word);
  check('   the final leaderboard has not appeared yet', !mh.phases.some((p) => p.endsWith(':gameover')) && mh.pub!.history.length === 1);
  check('   a player cannot give a second clue in a round, or after clues close', await m2.expectError(() => m2.send({ t: 'clue', text: 'again' }), 'late clue'));
  const afterG1 = Object.fromEntries(mh.pub!.players.map((p) => [p.id, p.score]));
  check('   non-host cannot move the table on', await m3.expectError(() => m3.send({ t: 'next' }), 'non-host next'));

  mh.send({ t: 'next' });
  // Game 2: a three-way split, so the vote ties and the imposter escapes.
  const g2 = await playGame((voter) => m[(m.indexOf(voter) + 1) % 3].id);
  check('7. game 2 starts with a new word', g2.game === 2 && g2.word !== g1.word, `${g1.word} / ${g2.word}`);
  check('   …and a freshly dealt imposter (exactly one)', m.filter((b) => g2.reveal.imposterIds.includes(b.id)).length === 1 && g2.reveal.imposterIds.length === 1);
  check('   game 2 also plays three full clue rounds before its one vote', g2.cluesAtDiscussion.length === 9 && !g2.leakedPhase && mh.phases.filter((p) => p.startsWith('2:')).join(' > ') === '2:roles > 2:clue > 2:discussion > 2:voting > 2:reveal');
  check('   the rotation carries on from where game 1 stopped', g2.starters.join() === [seats[3 % 3], seats[4 % 3], seats[5 % 3]].join());
  const afterG2 = Object.fromEntries(mh.pub!.players.map((p) => [p.id, p.score]));
  const sumDeltas = (id: string) => mh.pub!.history.reduce((a, h) => a + (h.scoreDelta[id] ?? 0), 0);
  check('8. scores carry forward: session score = game 1 points + game 2 points', mh.pub!.players.every((p) => afterG2[p.id] === (afterG1[p.id] ?? 0) + (g2.reveal.scoreDelta[p.id] ?? 0) && afterG2[p.id] === sumDeltas(p.id)));
  check('   the tied game gave the escaping imposter exactly one point', g2.reveal.tie && g2.reveal.outcome === 'escaped' && afterG2[g2.imposter.id] - (afterG1[g2.imposter.id] ?? 0) === 1);
  check('   still no final leaderboard while game 2 results are showing', mh.pub!.phase === 'reveal' && !mh.phases.some((p) => p.endsWith(':gameover')));

  mh.send({ t: 'next' });
  await mh.until(() => mh.pub!.phase === 'gameover', 'final leaderboard');
  check('9. the final session leaderboard appears only after game 2 results', mh.phases.indexOf('2:gameover') === mh.phases.length - 1 && mh.phases.indexOf('2:reveal') === mh.phases.length - 2);
  check('   it carries the game-by-game results', mh.pub!.history.length === 2 && mh.pub!.history[0].word === g1.word && mh.pub!.history[1].word === g2.word && mh.pub!.history[0].outcome === 'caught');
  check('   and each player’s total score', mh.pub!.players.every((p) => p.score === afterG2[p.id]) && mh.pub!.players.reduce((a, p) => a + p.score, 0) === 1);
  check('   non-host cannot press Play Again', await m2.expectError(() => m2.send({ t: 'next' }), 'non-host again'));

  mh.send({ t: 'next' }); // Play Again
  await mh.until(() => mh.pub!.phase === 'roles' && mh.pub!.game === 1, 'fresh session');
  check('Play Again starts a fresh session with the same settings and zeroed scores', mh.pub!.players.every((p) => p.score === 0 && p.won === 0) && mh.pub!.history.length === 0 && mh.pub!.settings.games === 2 && mh.pub!.settings.rounds === 3);
  check('settings cannot be changed in the middle of a session', await mh.expectError(() => mh.send({ t: 'settings', settings: { rounds: 1 } }), 'mid-session settings'));
  for (const b of m) b.ws.terminate();
  B.server.close();

  // ==================================================================
  // PART C — the table moves on by itself after each game's results
  // ==================================================================
  console.log('\nAutomatic progression — 3 players, 2 games, 1 clue round, no host input after the start');
  const C = await boot({ rolesMs: 5000, nextMs: 350 });
  const c = [await C.mk('A'), await C.mk('B'), await C.mk('C')];
  const ch = c[0];
  ch.send({ t: 'create', playerId: ch.id, name: 'A', look, settings: { games: 2, rounds: 1, discussionSeconds: 15, votingSeconds: 15, clueSeconds: 10 } });
  await ch.until(() => !!ch.pub, 'auto room');
  for (const b of c.slice(1)) b.send({ t: 'join', code: ch.pub!.code, playerId: b.id, name: b.name, look });
  await ch.until(() => ch.pub!.players.length === 3, 'auto table');
  const autoGame = async (game: number) => {
    await ch.until(() => ch.pub!.phase === 'roles' && ch.pub!.game === game, `auto roles ${game}`);
    await Promise.all(c.map((b) => b.until(() => b.pub!.game === game && b.pub!.phase === 'roles' && b.priv!.role !== 'spectator', 'auto dealt')));
    for (const b of c) b.send({ t: 'seen' });
    await ch.until(() => ch.pub!.phase === 'clue', 'auto clue');
    for (const id of ch.pub!.roundOrder.slice()) {
      const b = c.find((x) => x.id === id)!;
      await b.until(() => b.pub!.currentId === b.id, 'auto turn');
      b.send({ t: 'clue', text: 'z' });
    }
    await ch.until(() => ch.pub!.phase === 'discussion', 'auto discussion');
    ch.send({ t: 'advance' });
    await ch.until(() => ch.pub!.phase === 'voting', 'auto voting');
    for (const b of c) b.send({ t: 'vote', targets: [c[(c.indexOf(b) + 1) % 3].id] });
    await ch.until(() => ch.pub!.phase === 'reveal' && ch.pub!.game === game, 'auto results');
  };
  ch.send({ t: 'start' });
  await autoGame(1);
  check('results show a countdown to the next game', (ch.pub!.phaseEndsAt ?? 0) > Date.now());
  await autoGame(2); // nobody pressed anything: game 2 was dealt by the timer
  check('the next game starts by itself when games remain', ch.pub!.game === 2);
  await ch.until(() => ch.pub!.phase === 'gameover', 'auto final', 3000);
  check('after the last game the final leaderboard appears by itself', ch.pub!.phase === 'gameover' && ch.pub!.history.length === 2);
  ch.send({ t: 'end' });
  await ch.until(() => ch.pub!.phase === 'lobby', 'back to lobby');
  check('Return to Lobby clears the session', ch.pub!.game === 0 && ch.pub!.history.length === 0 && ch.pub!.players.every((p) => p.score === 0 && !p.waiting));
  for (const b of c) b.ws.terminate();
  C.server.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
