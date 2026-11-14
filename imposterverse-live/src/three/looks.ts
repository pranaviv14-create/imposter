// The character wardrobe. Everything here is cosmetic only.
import type { CharacterLook } from '../../shared/types';

export type BodyStyle = 'suit' | 'hoodie' | 'trench' | 'ruff' | 'uniform' | 'knit' | 'cloak';

export interface BodyDef {
  id: string;
  name: string;
  vibe: string;
  blurb: string;
  style: BodyStyle;
  shoulders: number;
  girth: number;
  tall: number;
  level: number; // unlock level
}

export const BODIES: BodyDef[] = [
  { id: 'tailor', name: 'The Tailor', vibe: 'Formal', blurb: 'Pressed lapels. Unreadable.', style: 'suit', shoulders: 1.0, girth: 1.0, tall: 1.0, level: 1 },
  { id: 'nightowl', name: 'The Night Owl', vibe: 'Casual', blurb: 'Hood up, guard down.', style: 'hoodie', shoulders: 1.04, girth: 1.12, tall: 0.95, level: 1 },
  { id: 'sleuth', name: 'The Sleuth', vibe: 'Classic', blurb: 'Collar high, eyes higher.', style: 'trench', shoulders: 1.08, girth: 1.02, tall: 1.05, level: 1 },
  { id: 'jester', name: 'The Jester', vibe: 'Funny', blurb: 'Round, ruffled, suspicious.', style: 'ruff', shoulders: 0.88, girth: 1.42, tall: 0.86, level: 1 },
  { id: 'captain', name: 'The Captain', vibe: 'Formal', blurb: 'Gold braid, straight face.', style: 'uniform', shoulders: 1.18, girth: 1.04, tall: 1.04, level: 2 },
  { id: 'scholar', name: 'The Scholar', vibe: 'Casual', blurb: 'Soft knit, sharp memory.', style: 'knit', shoulders: 0.88, girth: 0.9, tall: 1.08, level: 3 },
  { id: 'vault', name: 'The Vault', vibe: 'Funny', blurb: 'Built like a locked door.', style: 'suit', shoulders: 1.36, girth: 1.4, tall: 1.0, level: 4 },
  { id: 'phantom', name: 'The Phantom', vibe: 'Mystery', blurb: 'A cloak and a rumour.', style: 'cloak', shoulders: 1.0, girth: 0.94, tall: 1.1, level: 6 },
];

export interface Palette {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  level: number;
}

export const PALETTES: Palette[] = [
  { name: 'Coral', primary: '#f2603a', secondary: '#f6f0e4', accent: '#ffd04f', level: 1 },
  { name: 'Mint', primary: '#35b98a', secondary: '#f6f0e4', accent: '#ff6b3d', level: 1 },
  { name: 'Violet', primary: '#7667ee', secondary: '#f6f0e4', accent: '#ffd04f', level: 1 },
  { name: 'Sun', primary: '#f5b92e', secondary: '#2b2546', accent: '#ff5480', level: 1 },
  { name: 'Sky', primary: '#3f97ee', secondary: '#f6f0e4', accent: '#ffd04f', level: 2 },
  { name: 'Rose', primary: '#ef4f7c', secondary: '#fbeef0', accent: '#2b2546', level: 3 },
  { name: 'Cream', primary: '#eadfcd', secondary: '#2b2546', accent: '#ff6b3d', level: 4 },
  { name: 'Ink', primary: '#322c52', secondary: '#f6f0e4', accent: '#5fe0ab', level: 5 },
];

export interface AccessoryDef {
  id: string;
  name: string;
  level: number;
}
export const ACCESSORIES: AccessoryDef[] = [
  { id: 'none', name: 'None', level: 1 },
  { id: 'bowtie', name: 'Bow tie', level: 1 },
  { id: 'scarf', name: 'Scarf', level: 1 },
  { id: 'pin', name: 'Star pin', level: 2 },
  { id: 'tophat', name: 'Top hat', level: 3 },
  { id: 'halo', name: 'Halo', level: 4 },
  { id: 'crown', name: 'Crown', level: 5 },
];

export const bodyOf = (look: CharacterLook): BodyDef => BODIES.find((b) => b.id === look.body) ?? BODIES[0];
export const paletteOf = (look: CharacterLook): Palette => PALETTES[look.palette] ?? PALETTES[0];

/** Stable 0..1 number from a string, so each player idles slightly differently. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
