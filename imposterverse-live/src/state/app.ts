// Device-local app state: navigation, preferences and the player profile.
// There are no accounts yet, so everything here lives in this browser only.
import { create } from 'zustand';
import type { CharacterLook } from '../../shared/types';

// `?p=2` gives a tab its own identity — handy for testing several players on one machine.
const slot = new URLSearchParams(location.search).get('p');
export const NS = 'ivl' + (slot ? ':' + slot.replace(/[^a-z0-9]/gi, '') : '');

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`${NS}:${key}`);
      return raw ? { ...(fallback as any), ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked — the game still works for this session */
    }
  },
};

// ---- navigation ------------------------------------------------------------

export type Screen = 'splash' | 'home' | 'online' | 'room' | 'offline' | 'modes' | 'friends' | 'profile' | 'settings' | 'howto' | 'legal';

interface NavState {
  screen: Screen;
  legalTab: 'privacy' | 'terms';
  go: (screen: Screen) => void;
  openLegal: (tab: 'privacy' | 'terms') => void;
}
export const useNav = create<NavState>((set) => ({
  screen: 'splash',
  legalTab: 'privacy',
  go: (screen) => set({ screen }),
  openLegal: (legalTab) => set({ screen: 'legal', legalTab }),
}));

// ---- preferences -----------------------------------------------------------

export interface Prefs {
  volume: number;
  reducedMotion: boolean;
  lowData: boolean;
  quality: 'auto' | 'high' | 'low';
  maskMode: 'segment' | 'lite';
  mirrorSelf: boolean;
}
const defaultPrefs: Prefs = {
  volume: 0.7,
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  lowData: false,
  quality: 'auto',
  maskMode: 'segment',
  mirrorSelf: true,
};
export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...storage.get('prefs', defaultPrefs),
  set: (p) => {
    set(p);
    const { set: _omit, ...rest } = get();
    storage.set('prefs', rest);
  },
}));

/** True when the scene should use its lighter rendering path. */
export function isLowGraphics(p: Pick<Prefs, 'quality' | 'lowData'>): boolean {
  if (p.quality === 'low' || p.lowData) return true;
  if (p.quality === 'high') return false;
  const nav = navigator as any;
  const weak = (nav.deviceMemory && nav.deviceMemory <= 4) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4);
  return !!weak && matchMedia('(pointer: coarse)').matches;
}

// ---- profile ---------------------------------------------------------------

export interface Friend {
  id: string;
  name: string;
  ts: number;
}
export interface Stats {
  games: number;
  wins: number;
  losses: number;
  escapes: number;
  catches: number;
  streak: number;
  bestStreak: number;
}
export interface Profile {
  id: string;
  name: string;
  look: CharacterLook;
  portrait: string | null;
  xp: number;
  stats: Stats;
  achievements: string[];
  friends: Friend[];
  recent: Friend[];
  blocked: string[];
  lastRoundKey: string;
}

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return 'IV' + Array.from(bytes, (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
};

const defaultProfile = (): Profile => ({
  id: newId(),
  name: '',
  look: { body: 'tailor', palette: 0, accessory: 'none', enhance: true },
  portrait: null,
  xp: 0,
  stats: { games: 0, wins: 0, losses: 0, escapes: 0, catches: 0, streak: 0, bestStreak: 0 },
  achievements: [],
  friends: [],
  recent: [],
  blocked: [],
  lastRoundKey: '',
});

export const ACHIEVEMENTS: { id: string; name: string; hint: string; test: (p: Profile) => boolean }[] = [
  { id: 'first', name: 'Opening Night', hint: 'Finish your first game', test: (p) => p.stats.games >= 1 },
  { id: 'escape', name: 'Clean Getaway', hint: 'Escape as the imposter', test: (p) => p.stats.escapes >= 1 },
  { id: 'catch', name: 'Sharp Eye', hint: 'Vote for the real imposter', test: (p) => p.stats.catches >= 1 },
  { id: 'streak3', name: 'On a Roll', hint: 'Win three games in a row', test: (p) => p.stats.bestStreak >= 3 },
  { id: 'regular', name: 'Table Regular', hint: 'Play ten games', test: (p) => p.stats.games >= 10 },
  { id: 'liar', name: 'Master of Lies', hint: 'Escape five times', test: (p) => p.stats.escapes >= 5 },
  { id: 'sleuth', name: 'Bloodhound', hint: 'Catch the imposter ten times', test: (p) => p.stats.catches >= 10 },
  { id: 'social', name: 'Inner Circle', hint: 'Add three friends', test: (p) => p.friends.length >= 3 },
];

/** Total XP needed to reach a level (level 1 = 0 XP). */
export const xpForLevel = (level: number) => 150 * ((level - 1) * level) / 2;
export function levelOf(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, progress: (xp - floor) / (next - floor), toNext: next - xp };
}

export interface RoundSummary {
  key: string;
  role: 'crew' | 'imposter';
  won: boolean;
  escaped: boolean;
  votedCorrectly: boolean;
  others: { id: string; name: string }[];
}

interface ProfileStore extends Profile {
  update: (p: Partial<Profile>) => void;
  recordRound: (r: RoundSummary) => { xp: number; unlocked: string[] } | null;
  addFriend: (f: { id: string; name: string }) => void;
  removeFriend: (id: string) => void;
  toggleBlock: (id: string) => void;
}

const persist = (s: ProfileStore) => {
  const { update, recordRound, addFriend, removeFriend, toggleBlock, ...data } = s;
  storage.set('profile', data);
};

export const useProfile = create<ProfileStore>((set, get) => {
  const initial = storage.get('profile', defaultProfile());
  storage.set('profile', initial);
  return {
    ...initial,
    update: (p) => {
      set(p);
      persist(get());
    },
    recordRound: (r) => {
      const s = get();
      if (s.lastRoundKey === r.key) return null; // never count a round twice (reloads, reconnects)
      const stats = { ...s.stats };
      stats.games += 1;
      if (r.won) {
        stats.wins += 1;
        stats.streak += 1;
        stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      } else {
        stats.losses += 1;
        stats.streak = 0;
      }
      if (r.escaped) stats.escapes += 1;
      if (r.votedCorrectly) stats.catches += 1;
      const xp = 20 + (r.won ? 30 : 0) + (r.votedCorrectly ? 10 : 0);
      const recent = [...r.others.map((o) => ({ ...o, ts: Date.now() })), ...s.recent.filter((x) => !r.others.some((o) => o.id === x.id))].slice(0, 24);
      set({ stats, xp: s.xp + xp, recent, lastRoundKey: r.key });
      const after = get();
      const unlocked = ACHIEVEMENTS.filter((a) => !after.achievements.includes(a.id) && a.test(after)).map((a) => a.id);
      if (unlocked.length) set({ achievements: [...after.achievements, ...unlocked] });
      persist(get());
      return { xp, unlocked };
    },
    addFriend: (f) => {
      const s = get();
      if (f.id === s.id || s.friends.some((x) => x.id === f.id)) return;
      set({ friends: [...s.friends, { ...f, ts: Date.now() }] });
      const after = get();
      const unlocked = ACHIEVEMENTS.filter((a) => !after.achievements.includes(a.id) && a.test(after)).map((a) => a.id);
      if (unlocked.length) set({ achievements: [...after.achievements, ...unlocked] });
      persist(get());
    },
    removeFriend: (id) => {
      set({ friends: get().friends.filter((x) => x.id !== id) });
      persist(get());
    },
    toggleBlock: (id) => {
      const b = get().blocked;
      set({ blocked: b.includes(id) ? b.filter((x) => x !== id) : [...b, id] });
      persist(get());
    },
  };
});
