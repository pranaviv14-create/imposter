// Types shared by the browser client, the offline mode and the game server.

/**
 * SESSION -> GAMES -> CLUE ROUNDS -> DISCUSSION -> VOTING -> RESULTS
 *
 * A GAME is one secret word and one imposter. Inside it, every player gives one clue in
 * each CLUE ROUND; after the last clue round comes one discussion, one vote and the results
 * (`reveal`). `gameover` is the final session leaderboard, shown only after the last game.
 */
export type Phase = 'lobby' | 'roles' | 'clue' | 'discussion' | 'voting' | 'reveal' | 'gameover';
export type Role = 'crew' | 'imposter' | 'spectator';
export type ScoringId = 'classic' | 'detective';

/** Purely cosmetic description of a player's character. Never affects gameplay. */
export interface CharacterLook {
  body: string;
  palette: number;
  accessory: string;
  /** Soft "studio light" grade applied to the live face. Does not alter identity. */
  enhance: boolean;
}

export interface Settings {
  mode: string;
  /** Number of games in the session. Each game has its own word, imposter and vote. */
  games: number;
  /** Number of clue rounds in each game. Every player gives exactly one clue per clue round. */
  rounds: number;
  maxPlayers: number;
  imposters: number;
  category: string; // category id, or 'random'
  clueSeconds: number;
  discussionSeconds: number;
  votingSeconds: number;
  votesPerPlayer: number;
  scoring: ScoringId;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'classic',
  games: 3,
  rounds: 2,
  maxPlayers: 8,
  imposters: 1,
  category: 'random',
  clueSeconds: 30,
  discussionSeconds: 90,
  votingSeconds: 45,
  votesPerPlayer: 1,
  scoring: 'classic',
};

export const LIMITS = {
  minPlayers: 3,
  maxPlayers: 10,
  nameLength: 16,
  clueLength: 40,
  chatLength: 160,
};

export interface PublicPlayer {
  id: string;
  name: string;
  look: CharacterLook;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  /** Joined mid-round; sits out until the next round starts. */
  waiting: boolean;
  /** Points across the whole session (every game played since the lobby). */
  score: number;
  /** This session: games won, times caught as imposter, successful escapes. */
  won: number;
  caught: number;
  escapes: number;
  cam: boolean;
  mic: boolean;
}

export interface Clue {
  playerId: string;
  text: string; // empty string = passed / timed out
  round: number;
}

export interface Reveal {
  outcome: 'caught' | 'escaped' | 'void';
  /** Votes were cast but nobody had a clear lead, so nobody was convicted. */
  tie: boolean;
  word: string;
  category: string;
  imposterIds: string[];
  /** voterId -> ids they voted for (empty = abstained) */
  votes: Record<string, string[]>;
  tally: Record<string, number>;
  accusedIds: string[];
  caughtIds: string[];
  escapedIds: string[];
  scoreDelta: Record<string, number>;
  /** id -> name snapshot, so the breakdown still reads correctly if someone leaves */
  names: Record<string, string>;
  voidReason?: string;
}

/** One finished game, kept for the game-by-game results on the final leaderboard. */
export interface GameResult {
  game: number;
  word: string;
  category: string;
  imposterIds: string[];
  outcome: 'caught' | 'escaped' | 'void';
  tie: boolean;
  scoreDelta: Record<string, number>;
  names: Record<string, string>;
}

export interface PublicState {
  code: string;
  phase: Phase;
  settings: Settings;
  players: PublicPlayer[];
  /** Game number within the session, from 1 (0 in the lobby). */
  game: number;
  /** The clue round being played within the current game, from 1. */
  round: number;
  /** The table for the current game, in seat order. */
  seatOrder: string[];
  /** Speaking order of the current clue round. The first speaker moves one seat every clue round. */
  roundOrder: string[];
  /** Who speaks first in the current clue round. */
  starterId: string | null;
  /** ids taking part in the current game */
  order: string[];
  /** Results of every finished game of the session, oldest first. */
  history: GameResult[];
  currentId: string | null;
  turn: number;
  totalTurns: number;
  clues: Clue[];
  category: string | null;
  phaseEndsAt: number | null;
  votedIds: string[];
  rolesSeenIds: string[];
  reveal: Reveal | null;
  now: number;
}

export interface PrivateState {
  role: Role;
  /** Only ever populated for crew members. */
  word: string | null;
  instruction: string;
  myVotes: string[] | null;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ---- wire protocol -------------------------------------------------------

export type ClientMsg =
  | { t: 'hello'; playerId: string }
  | { t: 'create'; playerId: string; name: string; look: CharacterLook; settings?: Partial<Settings> }
  | { t: 'join'; code: string; playerId: string; token?: string; name: string; look: CharacterLook }
  | { t: 'leave' }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; settings: Partial<Settings> }
  | { t: 'look'; name?: string; look?: CharacterLook }
  | { t: 'start' }
  | { t: 'seen' }
  | { t: 'clue'; text: string }
  | { t: 'advance' }
  | { t: 'vote'; targets: string[] }
  | { t: 'next' }
  | { t: 'end' }
  | { t: 'kick'; id: string }
  | { t: 'host'; id: string }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emote: string }
  | { t: 'speaking'; on: boolean }
  | { t: 'media'; cam: boolean; mic: boolean }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'report'; id: string; reason: string };

export type ServerMsg =
  | { t: 'joined'; code: string; playerId: string; token: string; ice: IceServer[] }
  | { t: 'state'; pub: PublicState; priv: PrivateState }
  | { t: 'left'; reason: 'left' | 'kicked' | 'closed' }
  | { t: 'error'; message: string; code?: string }
  | { t: 'chat'; id: string; name: string; text: string; ts: number }
  | { t: 'emote'; id: string; emote: string }
  | { t: 'speaking'; id: string; on: boolean }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'notice'; message: string };

export const EMOTES = ['laugh', 'gasp', 'think', 'sus', 'clap', 'heart'] as const;
export type EmoteId = (typeof EMOTES)[number];
