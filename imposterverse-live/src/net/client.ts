// WebSocket client for the game server, with automatic reconnection.
import { create } from 'zustand';
import type { ClientMsg, PrivateState, PublicState, ServerMsg, Settings } from '../../shared/types';
import { NS, useNav, useProfile } from '../state/app';
import { mesh } from './rtc';
import { sfx } from '../audio/sfx';

export interface ChatLine {
  id: string;
  name: string;
  text: string;
  ts: number;
}

interface Session {
  code: string;
  token: string;
}

interface NetState {
  conn: 'idle' | 'connecting' | 'open' | 'lost';
  pub: PublicState | null;
  priv: PrivateState | null;
  session: Session | null;
  /** serverTime - localTime, for accurate countdowns */
  offset: number;
  chat: ChatLine[];
  unread: number;
  chatOpen: boolean;
  emotes: Record<string, { emote: string; at: number }>;
  speaking: Record<string, boolean>;
  error: string | null;
  notice: string | null;
  busy: boolean;
}

const SESSION_KEY = `${NS}:session`;
const loadSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const saveSession = (s: Session | null) => {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};

export const useNet = create<NetState>(() => ({
  conn: 'idle',
  pub: null,
  priv: null,
  session: loadSession(),
  offset: 0,
  chat: [],
  unread: 0,
  chatOpen: false,
  emotes: {},
  speaking: {},
  error: null,
  notice: null,
  busy: false,
}));

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let opening: Promise<void> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Where the game server lives.
 * Set VITE_SERVER_URL at build time when the client is hosted separately from the
 * server (e.g. client on Netlify, server on Render): https://your-server.onrender.com
 * Leave it unset when one process serves both — then it is simply this page's own address.
 * Nothing is hard-coded: there is no localhost or deployment address in the source.
 */
export function serverBase(): string {
  const raw = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').trim();
  if (!raw) return location.origin;
  // Tolerate a pasted trailing slash, a /ws suffix, or a ws:// / wss:// address.
  return raw.replace(/\/+$/, '').replace(/\/ws$/, '').replace(/^ws(s?):\/\//, 'http$1://');
}

/** The game socket: https -> wss, http -> ws. */
function endpoint(): string {
  return serverBase().replace(/^http/, 'ws') + '/ws';
}

export function showNotice(message: string) {
  useNet.setState({ notice: message });
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => useNet.setState({ notice: null }), 3600);
}

function rawSend(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function resetRoom() {
  saveSession(null);
  mesh.closeAll();
  useNet.setState({ pub: null, priv: null, session: null, chat: [], unread: 0, emotes: {}, speaking: {}, busy: false, chatOpen: false });
}

function onMessage(m: ServerMsg) {
  const me = useProfile.getState();
  switch (m.t) {
    case 'joined': {
      const session = { code: m.code, token: m.token };
      saveSession(session);
      mesh.configure({ myId: m.playerId, ice: m.ice, send: (to, data) => rawSend({ t: 'signal', to, data }) });
      useNet.setState({ session, error: null, busy: false });
      if (useNav.getState().screen !== 'room') useNav.getState().go('room');
      break;
    }
    case 'state': {
      useNet.setState({ pub: m.pub, priv: m.priv, offset: m.pub.now - Date.now() });
      mesh.sync(m.pub.players.filter((p) => p.connected && !me.blocked.includes(p.id)).map((p) => p.id));
      break;
    }
    case 'left':
      resetRoom();
      if (m.reason === 'kicked') useNet.setState({ error: 'The host removed you from the room.' });
      if (m.reason === 'closed') useNet.setState({ error: 'This room was opened in another tab.' });
      if (useNav.getState().screen === 'room') useNav.getState().go(m.reason === 'left' ? 'home' : 'online');
      break;
    case 'error': {
      const hadSession = !!useNet.getState().session;
      useNet.setState({ error: m.message, busy: false });
      sfx.error();
      // A failed automatic rejoin (room gone, seat lost) must not leave us stuck on a dead room.
      if (hadSession && !useNet.getState().pub && ['no-room', 'taken', 'banned', 'full', 'no-session'].includes(m.code ?? '')) {
        resetRoom();
        if (useNav.getState().screen === 'room') useNav.getState().go('online');
      }
      break;
    }
    case 'chat': {
      if (me.blocked.includes(m.id)) break;
      const s = useNet.getState();
      useNet.setState({ chat: [...s.chat.slice(-80), m], unread: s.chatOpen ? 0 : s.unread + (m.id === me.id ? 0 : 1) });
      break;
    }
    case 'emote':
      if (me.blocked.includes(m.id)) break;
      useNet.setState({ emotes: { ...useNet.getState().emotes, [m.id]: { emote: m.emote, at: Date.now() } } });
      if (m.id !== me.id) sfx.emote();
      break;
    case 'speaking':
      useNet.setState({ speaking: { ...useNet.getState().speaking, [m.id]: m.on } });
      break;
    case 'signal':
      if (!me.blocked.includes(m.from)) void mesh.signal(m.from, m.data);
      break;
    case 'notice':
      showNotice(m.message);
      break;
  }
}

function connect(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (opening) return opening;
  useNet.setState({ conn: useNet.getState().conn === 'lost' ? 'lost' : 'connecting' });
  opening = new Promise<void>((resolve, reject) => {
    let settled = false;
    const sock = new WebSocket(endpoint());
    ws = sock;
    sock.onopen = () => {
      settled = true;
      opening = null;
      retry = 0;
      useNet.setState({ conn: 'open' });
      const me = useProfile.getState();
      rawSend({ t: 'hello', playerId: me.id });
      const session = useNet.getState().session;
      // Reconnection: claim our seat back with the room token.
      if (session) rawSend({ t: 'join', code: session.code, playerId: me.id, token: session.token, name: me.name, look: me.look });
      resolve();
    };
    sock.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch (err) {
        console.warn('[net] bad message', err);
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      opening = null;
      if (!settled) reject(new Error('offline'));
      const inRoom = !!useNet.getState().session;
      useNet.setState({ conn: inRoom ? 'lost' : 'idle' });
      if (inRoom) scheduleRetry();
    };
    sock.onerror = () => {};
  });
  return opening;
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = Math.min(8000, 600 * 2 ** retry++);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (useNet.getState().session) connect().catch(() => scheduleRetry());
  }, delay);
}

// Come back quickly when the device wakes up or regains signal.
if (typeof window !== 'undefined') {
  const nudge = () => {
    if (useNet.getState().session && (!ws || ws.readyState > WebSocket.OPEN)) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retry = 0;
      connect().catch(() => scheduleRetry());
    }
  };
  window.addEventListener('online', nudge);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && nudge());
}

async function request(msg: ClientMsg) {
  useNet.setState({ busy: true, error: null });
  try {
    await connect();
    rawSend(msg);
  } catch {
    useNet.setState({ busy: false, conn: 'idle', error: 'Could not reach the game server. Check your connection and try again.' });
  }
}

export const net = {
  send: rawSend,
  /** Resume a room after a page reload. */
  resume() {
    if (useNet.getState().session) {
      useNav.getState().go('room');
      connect().catch(() => scheduleRetry());
    }
  },
  createRoom(settings?: Partial<Settings>) {
    const me = useProfile.getState();
    return request({ t: 'create', playerId: me.id, name: me.name, look: me.look, settings });
  },
  joinRoom(code: string) {
    const me = useProfile.getState();
    return request({ t: 'join', code: code.trim().toUpperCase(), playerId: me.id, name: me.name, look: me.look });
  },
  leaveRoom() {
    rawSend({ t: 'leave' });
    resetRoom();
    useNav.getState().go('home');
  },
  clearError: () => useNet.setState({ error: null }),
  setChatOpen: (open: boolean) => useNet.setState({ chatOpen: open, unread: 0 }),
  now: () => Date.now() + useNet.getState().offset,
};
