// Pure game rules. No I/O, no timers, no DOM — the online server and the
// offline pass-the-phone mode both run on exactly this code.

import { CATEGORIES } from './words';
import { LIMITS, type PrivateState, type Reveal, type ScoringId, type Settings } from './types';

export type Rng = () => number;

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Everything the round needs that must stay hidden until the reveal. */
export interface RoundSecret {
  word: string;
  category: string; // category id
  imposterIds: string[];
}

/** Picks a word, avoiding anything in `used` until a category is exhausted. */
export function pickWord(categoryId: string, used: Set<string>, rng: Rng = Math.random): { word: string; category: string } {
  const pool = categoryId === 'random' ? CATEGORIES : CATEGORIES.filter((c) => c.id === categoryId);
  const cats = pool.length ? pool : CATEGORIES;
  let options = cats.flatMap((c) => c.words.filter((w) => !used.has(w)).map((w) => ({ word: w, category: c.id })));
  if (!options.length) {
    // Every word in the pool has been played: forget history for this pool.
    for (const c of cats) for (const w of c.words) used.delete(w);
    options = cats.flatMap((c) => c.words.map((w) => ({ word: w, category: c.id })));
  }
  const choice = options[Math.floor(rng() * options.length)];
  used.add(choice.word);
  return choice;
}

/** Largest imposter count that still leaves the crew a strict majority. */
export function maxImposters(playerCount: number): number {
  return Math.max(1, Math.min(3, Math.ceil(playerCount / 2) - 1));
}

export function sanitizeSettings(input: Partial<Settings>, base: Settings): Settings {
  const n = (v: unknown, lo: number, hi: number, fallback: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
  };
  const s: Settings = { ...base };
  if (input.mode !== undefined && MODES[input.mode]?.status === 'live') s.mode = input.mode;
  if (input.games !== undefined) s.games = n(input.games, 1, 10, base.games);
  if (input.rounds !== undefined) s.rounds = n(input.rounds, 1, 6, base.rounds);
  if (input.maxPlayers !== undefined) s.maxPlayers = n(input.maxPlayers, LIMITS.minPlayers, LIMITS.maxPlayers, base.maxPlayers);
  if (input.imposters !== undefined) s.imposters = n(input.imposters, 1, 3, base.imposters);
  if (input.category !== undefined && (input.category === 'random' || CATEGORIES.some((c) => c.id === input.category)))
    s.category = input.category;
  if (input.clueSeconds !== undefined) s.clueSeconds = n(input.clueSeconds, 10, 120, base.clueSeconds);
  if (input.discussionSeconds !== undefined) s.discussionSeconds = n(input.discussionSeconds, 15, 300, base.discussionSeconds);
  if (input.votingSeconds !== undefined) s.votingSeconds = n(input.votingSeconds, 15, 120, base.votingSeconds);
  if (input.votesPerPlayer !== undefined) s.votesPerPlayer = n(input.votesPerPlayer, 1, 3, base.votesPerPlayer);
  if (input.scoring === 'classic' || input.scoring === 'detective') s.scoring = input.scoring;
  s.imposters = Math.min(s.imposters, maxImposters(s.maxPlayers));
  s.votesPerPlayer = Math.min(s.votesPerPlayer, s.imposters);
  return s;
}

// ---- game modes ----------------------------------------------------------

export interface GameMode {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: 'live' | 'soon';
  minPlayers: number;
  /** Deals a round. Only present for playable modes. */
  deal?: (ids: string[], settings: Settings, used: Set<string>, rng: Rng) => RoundSecret;
  /** What a single player is allowed to know. */
  privateFor?: (secret: RoundSecret, id: string, categoryLabel: string) => Pick<PrivateState, 'role' | 'word' | 'instruction'>;
}

const classic: GameMode = {
  id: 'classic',
  name: 'Classic Imposter',
  tagline: 'One word. One liar.',
  description:
    'Everyone receives the same secret word — except the imposter, who must bluff through a round of one-word clues without being voted out.',
  status: 'live',
  minPlayers: 3,
  deal(ids, settings, used, rng) {
    const count = Math.min(settings.imposters, maxImposters(ids.length));
    const imposterIds = shuffle(ids, rng).slice(0, count);
    const { word, category } = pickWord(settings.category, used, rng);
    return { word, category, imposterIds };
  },
  privateFor(secret, id, categoryLabel) {
    if (secret.imposterIds.includes(id)) {
      return {
        role: 'imposter',
        word: null,
        instruction: `You are the imposter. You do not know the word. The category is ${categoryLabel}. Listen closely, bluff, and blend in.`,
      };
    }
    return {
      role: 'crew',
      word: secret.word,
      instruction: 'Give a clue that proves you know the word — without handing it to the imposter.',
    };
  },
};

export const MODES: Record<string, GameMode> = {
  classic,
  spy: {
    id: 'spy',
    name: 'Who Is The Spy?',
    tagline: 'Everyone knows where. One does not.',
    description: 'All players share a secret location except the spy. Ask each other questions and expose the one who is guessing.',
    status: 'soon',
    minPlayers: 4,
  },
  mafia: {
    id: 'mafia',
    name: 'Mafia',
    tagline: 'The town sleeps. Someone does not.',
    description: 'Secret teams, special roles, night actions and daytime eliminations.',
    status: 'soon',
    minPlayers: 6,
  },
  bluff: {
    id: 'bluff',
    name: 'Double Bluff',
    tagline: 'Two truths. One misdirection.',
    description: 'Everyone holds a piece of secret information. Work out who is quietly steering the table wrong.',
    status: 'soon',
    minPlayers: 4,
  },
};

// ---- voting & scoring ----------------------------------------------------

export interface TallyResult {
  tally: Record<string, number>;
  accusedIds: string[];
}

/**
 * Counts votes and decides who is accused.
 * With K imposters the K most-voted players are accused. A tie that straddles
 * the cut-off convicts nobody in that tie — the table could not agree — and a
 * player with zero votes is never accused.
 */
export function tallyVotes(votes: Record<string, string[]>, candidates: string[], slots: number): TallyResult {
  const tally: Record<string, number> = {};
  for (const id of candidates) tally[id] = 0;
  for (const targets of Object.values(votes)) for (const t of targets) if (t in tally) tally[t] += 1;

  const ranked = candidates.filter((id) => tally[id] > 0).sort((a, b) => tally[b] - tally[a]);
  const accusedIds: string[] = [];
  let i = 0;
  while (i < ranked.length && accusedIds.length < slots) {
    const score = tally[ranked[i]];
    const group = ranked.filter((id) => tally[id] === score);
    if (accusedIds.length + group.length > slots) break; // tie across the cut-off
    accusedIds.push(...group);
    i += group.length;
  }
  return { tally, accusedIds };
}

export function scoreRound(
  scoring: ScoringId,
  participants: string[],
  imposterIds: string[],
  accusedIds: string[],
): Pick<Reveal, 'outcome' | 'caughtIds' | 'escapedIds' | 'scoreDelta'> {
  const caughtIds = imposterIds.filter((id) => accusedIds.includes(id));
  const escapedIds = imposterIds.filter((id) => !accusedIds.includes(id));
  const outcome = escapedIds.length === 0 ? 'caught' : 'escaped';
  const scoreDelta: Record<string, number> = {};
  for (const id of participants) scoreDelta[id] = 0;
  // Default (original) scoring: an imposter earns one point for escaping; nobody else scores.
  for (const id of escapedIds) scoreDelta[id] = 1;
  if (scoring === 'detective' && outcome === 'caught') {
    for (const id of participants) if (!imposterIds.includes(id)) scoreDelta[id] = 1;
  }
  return { outcome, caughtIds, escapedIds, scoreDelta };
}

/** Rough length of the whole session in minutes, for the setup screen. */
export function estimateMinutes(settings: Settings, players: number): number {
  const perGame = 20 + players * settings.clueSeconds * 0.6 * settings.rounds + settings.discussionSeconds + settings.votingSeconds * 0.6 + 20;
  return Math.max(1, Math.round((perGame * settings.games) / 60));
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
export const gameTitle = (round: number): string => (round >= 1 && round <= ORDINALS.length ? `${ORDINALS[round - 1]} Game` : `Game ${round}`);

export function cleanText(input: unknown, max: number): string {
  return String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
