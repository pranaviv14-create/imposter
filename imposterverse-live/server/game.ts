// IMPOSTERVERSE LIVE — authoritative game server.
//
// All game state lives here. Clients only ever receive a public view plus their
// own private view, so secret roles and the secret word cannot be read from
// another player's device. Every action (clue, vote, score) is validated here.
//
// Video and voice never touch this process: it only relays the small WebRTC
// signalling messages peers need to connect to each other directly.

import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import {
  DEFAULT_SETTINGS,
  EMOTES,
  LIMITS,
  type CharacterLook,
  type ClientMsg,
  type Clue,
  type GameResult,
  type IceServer,
  type Phase,
  type PrivateState,
  type PublicState,
  type Reveal,
  type ServerMsg,
  type Settings,
} from '../shared/types';
import { MODES, cleanText, sanitizeSettings, scoreRound, tallyVotes, type RoundSecret } from '../shared/engine';
import { categoryName } from '../shared/words';

export interface GameServerOptions {
  rolesMs?: number;
  lobbyGraceMs?: number;
  gameGraceMs?: number;
  hostGraceMs?: number;
  offlineTurnMs?: number;
  nextMs?: number;
  reportFile?: string | null;
  quiet?: boolean;
}

interface SPlayer {
  id: string;
  token: string;
  name: string;
  look: CharacterLook;
  ws: WebSocket | null;
  connected: boolean;
  ready: boolean;
  waiting: boolean;
  /** Points across the whole session. */
  score: number;
  won: number;
  caught: number;
  escapes: number;
  cam: boolean;
  mic: boolean;
  dropTimer: NodeJS.Timeout | null;
  lastChat: number;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, SPlayer>; // insertion order is seat order
  banned: Set<string>;
  settings: Settings;
  phase: Phase;
  /** Which game (match) of the session this is, from 1. 0 in the lobby. */
  game: number;
  /** The clue round being played within the current game, from 1. */
  round: number;
  /** The table's fixed turn order for the current game. */
  seatOrder: string[];
  /** Clue rounds played so far in this session; drives the rotating first speaker. */
  roundsPlayed: number;
  history: GameResult[];
  order: string[];
  queue: { id: string; round: number }[];
  turn: number;
  clues: Clue[];
  votes: Map<string, string[]>;
  rolesSeen: Set<string>;
  secret: RoundSecret | null;
  names: Record<string, string>;
  reveal: Reveal | null;
  usedWords: Set<string>;
  timer: NodeJS.Timeout | null;
  phaseEndsAt: number | null;
  hostTimer: NodeJS.Timeout | null;
}

interface Ctx {
  room: Room | null;
  playerId: string | null;
  helloId: string | null;
  windowStart: number;
  count: number;
  badJoins: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

function defaultIce(): IceServer[] {
  // TURN credentials come from the environment — never from source control.
  if (process.env.ICE_SERVERS) {
    try {
      return JSON.parse(process.env.ICE_SERVERS);
    } catch {
      console.warn('[game] ICE_SERVERS is not valid JSON — ignoring');
    }
  }
  const ice: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    ice.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return ice;
}

function validLook(look: any): CharacterLook {
  return {
    body: cleanText(look?.body, 20) || 'tailor',
    palette: Math.max(0, Math.min(20, Math.round(Number(look?.palette)) || 0)),
    accessory: cleanText(look?.accessory, 20) || 'none',
    enhance: !!look?.enhance,
  };
}

export function createGame(options: GameServerOptions = {}) {
  const opt = {
    // The round moves on when every seated player has looked at their card; this is only the safety net.
    rolesMs: options.rolesMs ?? 45000,
    lobbyGraceMs: options.lobbyGraceMs ?? 30000,
    gameGraceMs: options.gameGraceMs ?? 120000,
    hostGraceMs: options.hostGraceMs ?? 8000,
    offlineTurnMs: options.offlineTurnMs ?? 5000,
    // How long a game's results stay up before the next game (or the final leaderboard) begins.
    nextMs: options.nextMs ?? 20000,
    reportFile: options.reportFile === undefined ? 'reports.jsonl' : options.reportFile,
    quiet: !!options.quiet,
  };
  const rooms = new Map<string, Room>();
  const online = new Map<string, number>();
  const ice = defaultIce();
  const log = (...a: unknown[]) => {
    if (!opt.quiet) console.log('[game]', ...a);
  };

  const send = (ws: WebSocket | null, msg: ServerMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (ws: WebSocket, message: string, code?: string) => send(ws, { t: 'error', message, code });

  const bump = (id: string, d: number) => {
    const n = (online.get(id) ?? 0) + d;
    if (n <= 0) online.delete(id);
    else online.set(id, n);
  };

  // ---- views -------------------------------------------------------------

  function publicState(room: Room): PublicState {
    const current = room.phase === 'clue' ? room.queue[room.turn]?.id ?? null : null;
    return {
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        look: p.look,
        isHost: p.id === room.hostId,
        ready: p.ready,
        connected: p.connected,
        waiting: p.waiting,
        score: p.score,
        won: p.won,
        caught: p.caught,
        escapes: p.escapes,
        cam: p.cam,
        mic: p.mic,
      })),
      game: room.game,
      seatOrder: room.seatOrder,
      roundOrder: roundOrder(room),
      starterId: roundOrder(room)[0] ?? null,
      history: room.history,
      round: room.round,
      order: room.order,
      currentId: current,
      turn: room.turn,
      totalTurns: room.queue.length,
      clues: room.clues,
      category: room.secret && room.phase !== 'lobby' ? room.secret.category : null,
      phaseEndsAt: room.phaseEndsAt,
      votedIds: [...room.votes.keys()],
      rolesSeenIds: [...room.rolesSeen],
      // The reveal object is only ever attached once voting has finished.
      reveal: room.phase === 'reveal' ? room.reveal : null,
      now: Date.now(),
    };
  }

  function privateState(room: Room, p: SPlayer): PrivateState {
    const inRound = room.secret && room.phase !== 'lobby' && room.order.includes(p.id);
    if (!inRound || !room.secret) {
      const seated = room.seatOrder.includes(p.id);
      return {
        role: 'spectator',
        word: null,
        instruction:
          room.phase === 'lobby' || room.phase === 'gameover' ? ''
          : 'A game is in progress. You will be dealt in when the next game starts.',
        myVotes: null,
      };
    }
    const mode = MODES[room.settings.mode];
    const view = mode.privateFor!(room.secret, p.id, categoryName(room.secret.category));
    return { ...view, myVotes: room.votes.get(p.id) ?? null };
  }

  function sync(room: Room) {
    const pub = publicState(room);
    for (const p of room.players.values()) if (p.connected) send(p.ws, { t: 'state', pub, priv: privateState(room, p) });
  }

  const cast = (room: Room, msg: ServerMsg, exceptId?: string) => {
    for (const p of room.players.values()) if (p.connected && p.id !== exceptId) send(p.ws, msg);
  };

  // ---- timers ------------------------------------------------------------

  function setTimer(room: Room, ms: number, fn: () => void) {
    if (room.timer) clearTimeout(room.timer);
    room.phaseEndsAt = Date.now() + ms;
    room.timer = setTimeout(() => {
      room.timer = null;
      fn();
    }, ms);
  }
  function clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.phaseEndsAt = null;
  }

  // ---- session and game flow ---------------------------------------------
  //
  //   SESSION
  //     GAME 1   one secret word, one imposter
  //       clue round 1 … clue round N     (first speaker moves one seat each clue round)
  //       discussion                      (once, after the last clue round)
  //       vote                            (once)
  //       results and scoring
  //     GAME 2   a new word, a newly drawn imposter
  //       …
  //   FINAL SESSION LEADERBOARD           (only after the last game)
  //
  // `settings.games`  = games in the session
  // `settings.rounds` = clue rounds in each game

  /** The speaking order of the clue round currently being played (or just finished). */
  function roundOrder(room: Room): string[] {
    return room.queue.filter((q) => q.round === room.round).map((q) => q.id);
  }

  /** A fresh session: scores and history start from zero. */
  function startSession(room: Room) {
    room.game = 0;
    room.roundsPlayed = 0;
    room.history = [];
    for (const p of room.players.values()) {
      p.score = 0;
      p.won = 0;
      p.caught = 0;
      p.escapes = 0;
    }
    log(room.code, 'session started:', room.settings.games, 'games of', room.settings.rounds, 'clue rounds');
    startGame(room);
  }

  /** Deals one game: a new word, exactly one newly drawn imposter, and the whole clue schedule. */
  function startGame(room: Room) {
    const mode = MODES[room.settings.mode];
    const seats = [...room.players.values()];
    room.game += 1;
    // The table for this game, in seat order. Anyone who joined during the last game is dealt in here.
    room.seatOrder = seats.filter((p) => p.connected).map((p) => p.id);
    for (const p of seats) p.waiting = !room.seatOrder.includes(p.id);
    const ids = room.seatOrder.slice();
    room.order = ids;
    // The word and the imposter are fixed here and stay the same for every clue round of the game.
    room.secret = mode.deal!(ids, { ...room.settings, imposters: 1 }, room.usedWords, Math.random);
    room.names = Object.fromEntries(seats.map((p) => [p.id, p.name]));

    // Every player speaks exactly once per clue round, and the first speaker moves on
    // one seat each clue round. The rotation carries on across games, so the same
    // person does not open every game. Decided here, on the server.
    const n = ids.length;
    room.queue = [];
    for (let r = 1; r <= room.settings.rounds; r++) {
      const start = n ? (room.roundsPlayed + r - 1) % n : 0;
      for (let k = 0; k < n; k++) room.queue.push({ id: ids[(start + k) % n], round: r });
    }
    room.roundsPlayed += room.settings.rounds;

    room.round = 1;
    room.turn = 0;
    room.clues = [];
    room.votes = new Map();
    room.rolesSeen = new Set();
    room.reveal = null;
    room.phase = 'roles';
    setTimer(room, opt.rolesMs, () => beginClues(room));
    log(room.code, 'game', room.game, 'dealt to', n, 'players; first speaker:', room.names[room.queue[0]?.id]);
    sync(room);
  }

  /** Every configured game has been played: the final session leaderboard. */
  function finishSession(room: Room) {
    clearTimer(room);
    room.phase = 'gameover';
    room.secret = null;
    room.reveal = null;
    room.order = [];
    room.queue = [];
    room.clues = [];
    room.votes = new Map();
    log(room.code, 'session finished after', room.game, 'games');
    sync(room);
  }

  /** After a game's results: the next game if any remain, otherwise the final leaderboard. */
  function advance(room: Room) {
    const mode = MODES[room.settings.mode];
    const present = [...room.players.values()].filter((p) => p.connected).length;
    if (room.game < room.settings.games && present >= mode.minPlayers) return startGame(room);
    finishSession(room);
  }

  function beginClues(room: Room) {
    room.phase = 'clue';
    room.turn = 0;
    startTurn(room);
  }

  function startTurn(room: Room) {
    while (room.turn < room.queue.length && !room.players.has(room.queue[room.turn].id)) room.turn++;
    // Discussion begins only when every clue round has been played out.
    if (room.turn >= room.queue.length) return beginDiscussion(room);
    const entry = room.queue[room.turn];
    room.round = entry.round;
    const p = room.players.get(entry.id)!;
    setTimer(room, p.connected ? room.settings.clueSeconds * 1000 : opt.offlineTurnMs, () => recordClue(room, ''));
    sync(room);
  }

  function recordClue(room: Room, text: string) {
    const entry = room.queue[room.turn];
    if (!entry) return;
    room.clues.push({ playerId: entry.id, text, round: entry.round });
    room.turn += 1;
    startTurn(room);
  }

  function beginDiscussion(room: Room) {
    room.phase = 'discussion';
    setTimer(room, room.settings.discussionSeconds * 1000, () => beginVoting(room));
    sync(room);
  }

  function beginVoting(room: Room) {
    room.phase = 'voting';
    room.votes = new Map();
    setTimer(room, room.settings.votingSeconds * 1000, () => finishGame(room));
    sync(room);
  }

  function allVoted(room: Room) {
    const voters = room.order.map((id) => room.players.get(id)).filter((p): p is SPlayer => !!p && p.connected);
    return voters.length > 0 && voters.every((p) => room.votes.has(p.id));
  }

  /** Closes the vote (or voids the game), scores it, records it and shows the results. */
  function finishGame(room: Room, voidReason?: string) {
    if (!room.secret || room.phase === 'reveal' || room.phase === 'lobby' || room.phase === 'gameover') return;
    clearTimer(room);
    const secret = room.secret;
    const base = { word: secret.word, category: secret.category, imposterIds: secret.imposterIds, names: room.names };
    if (voidReason) {
      room.reveal = { ...base, outcome: 'void', tie: false, votes: {}, tally: {}, accusedIds: [], caughtIds: [], escapedIds: [], scoreDelta: {}, voidReason };
    } else {
      const votes: Record<string, string[]> = {};
      for (const id of room.order) votes[id] = room.votes.get(id) ?? [];
      const present = secret.imposterIds.filter((id) => room.order.includes(id));
      const { tally, accusedIds } = tallyVotes(votes, room.order, present.length);
      const result = scoreRound(room.settings.scoring, room.order, present, accusedIds);
      for (const [id, d] of Object.entries(result.scoreDelta)) {
        const p = room.players.get(id);
        if (p) p.score += d; // scores only ever change here, and they carry across the whole session
      }
      for (const id of room.order) {
        const p = room.players.get(id);
        if (!p) continue;
        const isImp = present.includes(id);
        if (isImp ? result.escapedIds.includes(id) : result.outcome === 'caught') p.won += 1;
        if (isImp && result.caughtIds.includes(id)) p.caught += 1;
        if (isImp && result.escapedIds.includes(id)) p.escapes += 1;
      }
      // A tie: votes were cast, but nobody had a clear lead, so nobody is convicted.
      const tie = accusedIds.length === 0 && Object.values(tally).some((v) => v > 0);
      room.reveal = { ...base, ...result, tie, votes, tally, accusedIds };
    }
    const r = room.reveal;
    room.history.push({ game: room.game, word: r.word, category: r.category, imposterIds: r.imposterIds, outcome: r.outcome, tie: r.tie, scoreDelta: r.scoreDelta, names: r.names });
    room.phase = 'reveal';
    log(room.code, 'game', room.game, '->', r.outcome);
    // The table moves on by itself: next game if any remain, otherwise the final leaderboard.
    setTimer(room, opt.nextMs, () => advance(room));
    sync(room);
  }

  function backToLobby(room: Room) {
    clearTimer(room);
    room.phase = 'lobby';
    room.round = 0;
    room.game = 0;
    room.seatOrder = [];
    room.roundsPlayed = 0;
    room.history = [];
    room.order = [];
    room.queue = [];
    room.clues = [];
    room.votes = new Map();
    room.rolesSeen = new Set();
    room.secret = null;
    room.reveal = null;
    for (const p of room.players.values()) {
      p.score = 0;
      p.won = 0;
      p.caught = 0;
      p.escapes = 0;
      p.ready = false;
      p.waiting = false;
    }
    sync(room);
  }

  // ---- membership --------------------------------------------------------

  function pickHost(room: Room) {
    const seats = [...room.players.values()];
    const next = seats.find((p) => p.connected && !p.waiting) ?? seats.find((p) => p.connected) ?? seats[0];
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      cast(room, { t: 'notice', message: `${next.name} is now the host.` });
    }
  }

  function destroyRoom(room: Room) {
    clearTimer(room);
    if (room.hostTimer) clearTimeout(room.hostTimer);
    for (const p of room.players.values()) if (p.dropTimer) clearTimeout(p.dropTimer);
    rooms.delete(room.code);
    log(room.code, 'closed');
  }

  function removePlayer(room: Room, id: string) {
    const p = room.players.get(id);
    if (!p) return;
    if (p.dropTimer) clearTimeout(p.dropTimer);
    room.players.delete(id);
    if (room.players.size === 0) return destroyRoom(room);
    if (room.hostId === id) pickHost(room);

    const playing = room.phase !== 'lobby' && room.phase !== 'reveal' && room.phase !== 'gameover' && room.order.includes(id);
    room.order = room.order.filter((x) => x !== id);
    // Their seat closes up; everyone else keeps their relative order.
    room.seatOrder = room.seatOrder.filter((x) => x !== id);
    if (playing && room.secret) {
      // Votes for someone who has left are handed back so they can be recast.
      room.votes.delete(id);
      for (const [voter, targets] of room.votes) {
        const kept = targets.filter((t) => t !== id);
        if (kept.length) room.votes.set(voter, kept);
        else room.votes.delete(voter);
      }
      room.rolesSeen.delete(id);
      const impostersLeft = room.secret.imposterIds.some((x) => room.order.includes(x));
      if (!impostersLeft) return finishGame(room, 'The imposter left the table.');
      if (room.order.length < LIMITS.minPlayers) return finishGame(room, 'Too few players remained to finish the round.');
      if (room.phase === 'clue') {
        const wasCurrent = room.queue[room.turn]?.id === id;
        room.queue = room.queue.filter((q, i) => i < room.turn || q.id !== id);
        if (wasCurrent) return startTurn(room);
      }
      if (room.phase === 'roles' && room.order.every((x) => room.rolesSeen.has(x))) return beginClues(room);
      if (room.phase === 'voting' && allVoted(room)) return finishGame(room);
    }
    sync(room);
  }

  function attach(ws: WebSocket, ctx: Ctx, room: Room, p: SPlayer) {
    if (p.ws && p.ws !== ws) {
      // Same player opened the room somewhere else: the newest connection wins.
      const old = p.ws;
      const oldCtx = ctxOf.get(old);
      if (oldCtx) {
        oldCtx.room = null;
        oldCtx.playerId = null;
      }
      send(old, { t: 'left', reason: 'closed' });
    }
    // Presence is counted once per socket, and released when the socket closes.
    if (!ctx.helloId) {
      ctx.helloId = p.id;
      bump(p.id, 1);
    }
    if (p.dropTimer) clearTimeout(p.dropTimer);
    p.dropTimer = null;
    p.ws = ws;
    p.connected = true;
    ctx.room = room;
    ctx.playerId = p.id;
    send(ws, { t: 'joined', code: room.code, playerId: p.id, token: p.token, ice });
    if (!room.players.get(room.hostId)?.connected) pickHost(room);
    sync(room);
  }

  function onDisconnect(room: Room, p: SPlayer) {
    p.ws = null;
    p.connected = false;
    p.cam = false;
    p.mic = false;
    cast(room, { t: 'speaking', id: p.id, on: false });
    const grace = room.phase === 'lobby' ? opt.lobbyGraceMs : opt.gameGraceMs;
    p.dropTimer = setTimeout(() => removePlayer(room, p.id), grace);

    if (room.hostId === p.id) {
      if (room.hostTimer) clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(() => {
        room.hostTimer = null;
        if (!room.players.get(room.hostId)?.connected) {
          pickHost(room);
          sync(room);
        }
      }, opt.hostGraceMs);
    }
    // Do not let an absent player stall the table.
    if (room.phase === 'clue' && room.queue[room.turn]?.id === p.id && room.phaseEndsAt && room.phaseEndsAt - Date.now() > opt.offlineTurnMs) {
      setTimer(room, opt.offlineTurnMs, () => recordClue(room, ''));
    }
    if (room.phase === 'voting' && allVoted(room)) return finishGame(room);
    if (room.phase === 'roles' && room.order.every((id) => room.rolesSeen.has(id) || !room.players.get(id)?.connected)) return beginClues(room);
    sync(room);
  }

  function uniqueName(room: Room, wanted: string, selfId: string) {
    const base = cleanText(wanted, LIMITS.nameLength) || 'Player';
    const taken = new Set([...room.players.values()].filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 99; i++) {
      const candidate = `${base.slice(0, LIMITS.nameLength - 2)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  function newPlayer(id: string, name: string, look: CharacterLook): SPlayer {
    return {
      id,
      token: crypto.randomBytes(18).toString('base64url'),
      name,
      look: validLook(look),
      ws: null,
      connected: false,
      ready: false,
      waiting: false,
      score: 0,
      won: 0,
      caught: 0,
      escapes: 0,
      cam: false,
      mic: false,
      dropTimer: null,
      lastChat: 0,
    };
  }

  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  // ---- message handling --------------------------------------------------

  const ctxOf = new WeakMap<WebSocket, Ctx>();
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(id);

  function handle(ws: WebSocket, ctx: Ctx, msg: ClientMsg) {
    // Messages that do not need a room.
    if (msg.t === 'hello') {
      if (validId(msg.playerId) && !ctx.helloId) {
        ctx.helloId = msg.playerId;
        bump(msg.playerId, 1);
      }
      return;
    }
    if (msg.t === 'create') {
      if (!validId(msg.playerId)) return fail(ws, 'Invalid player.');
      if (ctx.room) leave(ws, ctx);
      const room: Room = {
        code: newCode(),
        hostId: msg.playerId,
        players: new Map(),
        banned: new Set(),
        settings: sanitizeSettings(msg.settings ?? {}, DEFAULT_SETTINGS),
        phase: 'lobby',
        game: 0,
        round: 0,
        seatOrder: [],
        roundsPlayed: 0,
        history: [],
        order: [],
        queue: [],
        turn: 0,
        clues: [],
        votes: new Map(),
        rolesSeen: new Set(),
        secret: null,
        names: {},
        reveal: null,
        usedWords: new Set(),
        timer: null,
        phaseEndsAt: null,
        hostTimer: null,
      };
      rooms.set(room.code, room);
      const p = newPlayer(msg.playerId, cleanText(msg.name, LIMITS.nameLength) || 'Host', msg.look);
      room.players.set(p.id, p);
      log(room.code, 'created by', p.name);
      return attach(ws, ctx, room, p);
    }
    if (msg.t === 'join') {
      if (!validId(msg.playerId)) return fail(ws, 'Invalid player.');
      const code = cleanText(msg.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        ctx.badJoins += 1;
        if (ctx.badJoins > 12) return ws.close(4008, 'Too many attempts');
        return fail(ws, 'No room with that code. Check the code and try again.', 'no-room');
      }
      if (room.banned.has(msg.playerId)) return fail(ws, 'You were removed from this room by the host.', 'banned');
      if (ctx.room && ctx.room !== room) leave(ws, ctx);
      const existing = room.players.get(msg.playerId);
      if (existing) {
        // Reconnection: the seat is only handed back to whoever holds its token.
        if (existing.token !== msg.token) return fail(ws, 'That player is already seated in this room.', 'taken');
        return attach(ws, ctx, room, existing);
      }
      if (room.players.size >= room.settings.maxPlayers) return fail(ws, 'That room is full.', 'full');
      const p = newPlayer(msg.playerId, '', msg.look);
      p.name = uniqueName(room, msg.name, p.id);
      p.waiting = room.phase !== 'lobby'; // late joiners sit out until the next game starts
      room.players.set(p.id, p);
      return attach(ws, ctx, room, p);
    }

    const room = ctx.room;
    const me = room && ctx.playerId ? room.players.get(ctx.playerId) : undefined;
    if (!room || !me) return fail(ws, 'You are not in a room.', 'no-session');
    const isHost = room.hostId === me.id;
    const hostOnly = () => {
      if (!isHost) fail(ws, 'Only the host can do that.');
      return isHost;
    };

    switch (msg.t) {
      case 'leave':
        return leave(ws, ctx);
      case 'ready':
        if (room.phase !== 'lobby') return;
        me.ready = !!msg.ready;
        return sync(room);
      case 'settings': {
        if (!hostOnly()) return;
        if (room.phase !== 'lobby' && room.phase !== 'gameover') return fail(ws, 'Match settings can only be changed between games.');
        const next = sanitizeSettings(msg.settings ?? {}, room.settings);
        next.maxPlayers = Math.max(next.maxPlayers, room.players.size);
        room.settings = next;
        return sync(room);
      }
      case 'look':
        if (msg.look) me.look = validLook(msg.look);
        if (msg.name && (room.phase === 'lobby' || me.waiting)) me.name = uniqueName(room, msg.name, me.id);
        return sync(room);
      case 'start':
      case 'next': {
        if (!hostOnly()) return;
        if (msg.t === 'start' && room.phase !== 'lobby') return;
        if (msg.t === 'next' && room.phase !== 'reveal' && room.phase !== 'gameover') return;
        const mode = MODES[room.settings.mode];
        // On a game's results the table moves on by itself after a short pause; the host can skip the wait.
        // That leads to the next game, or to the final leaderboard after the last one.
        if (room.phase === 'reveal') return advance(room);
        // From the lobby, or "play again" from the final leaderboard: a fresh session with the current settings.
        const present = [...room.players.values()].filter((p) => p.connected).length;
        if (present < mode.minPlayers) return fail(ws, `You need at least ${mode.minPlayers} players at the table.`);
        return startSession(room);
      }
      case 'end':
        if (!hostOnly()) return;
        return backToLobby(room);
      case 'seen':
        if (room.phase !== 'roles' || !room.order.includes(me.id)) return;
        room.rolesSeen.add(me.id);
        if (room.order.every((id) => room.rolesSeen.has(id) || !room.players.get(id)?.connected)) return beginClues(room);
        return sync(room);
      case 'clue': {
        if (room.phase !== 'clue') return fail(ws, 'Clues are closed.');
        if (room.queue[room.turn]?.id !== me.id) return fail(ws, 'It is not your turn.', 'not-turn');
        const text = cleanText(msg.text, LIMITS.clueLength);
        if (!text) return fail(ws, 'Type a clue first.');
        return recordClue(room, text);
      }
      case 'advance':
        if (!hostOnly()) return;
        if (room.phase === 'roles') return beginClues(room);
        if (room.phase === 'clue') return recordClue(room, '');
        if (room.phase === 'discussion') return beginVoting(room);
        // Voting can never be cut short by the host: results only appear when
        // everyone has voted or the timer has run out.
        return fail(ws, 'This stage cannot be skipped.');
      case 'vote': {
        if (room.phase !== 'voting' || !room.secret) return fail(ws, 'Voting is closed.');
        if (!room.order.includes(me.id)) return fail(ws, 'You are not part of this round.');
        if (room.votes.has(me.id)) return fail(ws, 'Your vote is already locked in.', 'duplicate');
        const limit = Math.min(room.settings.votesPerPlayer, room.secret.imposterIds.length);
        const targets = Array.isArray(msg.targets) ? [...new Set(msg.targets.filter((x) => typeof x === 'string'))] : [];
        if (targets.length < 1 || targets.length > limit) return fail(ws, `Choose ${limit === 1 ? 'one player' : `up to ${limit} players`}.`);
        if (targets.includes(me.id)) return fail(ws, 'You cannot vote for yourself.');
        if (!targets.every((id) => room.order.includes(id))) return fail(ws, 'That player is not in this round.');
        room.votes.set(me.id, targets);
        if (allVoted(room)) return finishGame(room);
        return sync(room);
      }
      case 'kick': {
        if (!hostOnly() || msg.id === me.id) return;
        const target = room.players.get(msg.id);
        if (!target) return;
        room.banned.add(target.id);
        if (target.ws) {
          const tctx = ctxOf.get(target.ws);
          if (tctx) {
            tctx.room = null;
            tctx.playerId = null;
          }
          send(target.ws, { t: 'left', reason: 'kicked' });
        }
        return removePlayer(room, target.id);
      }
      case 'host': {
        if (!hostOnly()) return;
        const target = room.players.get(msg.id);
        if (!target || !target.connected) return;
        room.hostId = target.id;
        cast(room, { t: 'notice', message: `${target.name} is now the host.` });
        return sync(room);
      }
      case 'chat': {
        const now = Date.now();
        if (now - me.lastChat < 600) return;
        me.lastChat = now;
        const text = cleanText(msg.text, LIMITS.chatLength);
        if (text) cast(room, { t: 'chat', id: me.id, name: me.name, text, ts: now });
        return;
      }
      case 'emote':
        if ((EMOTES as readonly string[]).includes(msg.emote)) cast(room, { t: 'emote', id: me.id, emote: msg.emote });
        return;
      case 'speaking':
        return cast(room, { t: 'speaking', id: me.id, on: !!msg.on }, me.id);
      case 'media':
        me.cam = !!msg.cam;
        me.mic = !!msg.mic;
        return sync(room);
      case 'signal': {
        // Relay only between two members of the same room.
        const target = room.players.get(msg.to);
        if (target?.connected) send(target.ws, { t: 'signal', from: me.id, data: msg.data });
        return;
      }
      case 'report': {
        const target = room.players.get(msg.id);
        if (!target) return;
        const entry = { ts: new Date().toISOString(), room: room.code, reporter: me.id, reported: target.id, reportedName: target.name, reason: cleanText(msg.reason, 200) };
        if (opt.reportFile) fs.appendFile(opt.reportFile, JSON.stringify(entry) + '\n', () => {});
        log('report', entry);
        return send(ws, { t: 'notice', message: 'Report received. Thank you.' });
      }
    }
  }

  function leave(ws: WebSocket, ctx: Ctx) {
    const room = ctx.room;
    const id = ctx.playerId;
    ctx.room = null;
    ctx.playerId = null;
    if (!room || !id) return;
    send(ws, { t: 'left', reason: 'left' });
    removePlayer(room, id);
  }

  function handleConnection(ws: WebSocket) {
    const ctx: Ctx = { room: null, playerId: null, helloId: null, windowStart: Date.now(), count: 0, badJoins: 0 };
    ctxOf.set(ws, ctx);
    (ws as any).isAlive = true;
    ws.on('pong', () => ((ws as any).isAlive = true));
    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - ctx.windowStart > 1000) {
        ctx.windowStart = now;
        ctx.count = 0;
      }
      if (++ctx.count > 150) return; // flood guard
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as any).t !== 'string') return;
      try {
        handle(ws, ctx, msg);
      } catch (err) {
        console.error('[game] handler error', err);
        fail(ws, 'Something went wrong.');
      }
    });
    ws.on('close', () => {
      if (ctx.helloId) bump(ctx.helloId, -1);
      const room = ctx.room;
      const p = room && ctx.playerId ? room.players.get(ctx.playerId) : undefined;
      if (room && p && p.ws === ws) onDisconnect(room, p);
    });
    ws.on('error', () => {});
  }

  return {
    handleConnection,
    presence: (ids: string[]) => Object.fromEntries(ids.slice(0, 100).map((id) => [id, online.has(id)])),
    stats: () => ({ rooms: rooms.size, online: online.size }),
    /** Test hook only — never exposed over the network. */
    _peek: (code: string) => rooms.get(code),
  };
}

export type Game = ReturnType<typeof createGame>;

// ---- which websites may connect ------------------------------------------
//
// When the client is hosted somewhere else (e.g. Netlify) the browser sends that
// site's address in the Origin header. ALLOWED_ORIGINS lists the sites that are
// allowed, comma separated:
//
//   ALLOWED_ORIGINS=https://my-game.netlify.app,https://www.my-game.com
//
// A * matches any run of characters, so https://*--my-game.netlify.app also
// admits Netlify deploy previews. Requests from the server's own address are
// always allowed. If the variable is not set, every origin is allowed (fine for
// local development; set it in production).

const normalise = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '').split(',').map(normalise).filter(Boolean);
}

export function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true;
  if (!origin) return false; // browsers always send it; anything else has no business here
  const o = normalise(origin);
  try {
    if (host && new URL(o).host === host.toLowerCase()) return true; // same-origin deployment
  } catch {
    return false;
  }
  return allowed.some((rule) => {
    if (!rule.includes('*')) return rule === o;
    const pattern = '^' + rule.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9.-]*') + '$';
    return new RegExp(pattern).test(o);
  });
}

/** Mounts the game on an existing HTTP server at the /ws path. */
export function attachGameServer(server: HttpServer, options: GameServerOptions & { allowedOrigins?: string[] } = {}): Game {
  const game = createGame(options);
  const allowed = options.allowedOrigins ?? [];
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') return; // leave other upgrades (e.g. Vite HMR) alone
    if (!originAllowed(req.headers.origin, req.headers.host, allowed)) {
      if (!options.quiet) console.warn('[game] refused a connection from origin', req.headers.origin ?? '(none)', '— add it to ALLOWED_ORIGINS if it is yours');
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => game.handleConnection(ws));
  });
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as any).isAlive === false) {
        ws.terminate();
        continue;
      }
      (ws as any).isAlive = false;
      ws.ping();
    }
  }, 25000);
  server.on('close', () => clearInterval(beat));
  return game;
}

/** Tiny JSON API (health check, friends' online status). Returns true if it answered. */
export function handleApi(game: Game, req: IncomingMessage, res: ServerResponse, allowed: string[] = []): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  // Cross-origin reads are only answered for the sites that are allowed to play.
  const origin = req.headers.origin;
  if (origin && originAllowed(origin, req.headers.host, allowed)) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' });
    res.end();
    return true;
  }
  if (url.pathname === '/api/health') {
    // Used by the host's health check and by uptime pings; deliberately tells nothing private.
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, ...game.stats() }));
    return true;
  }
  if (url.pathname === '/api/presence') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    res.writeHead(200, headers);
    res.end(JSON.stringify(game.presence(ids)));
    return true;
  }
  return false;
}
