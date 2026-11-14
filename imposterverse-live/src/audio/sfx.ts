// Original sound design, synthesised live with the Web Audio API.
// No audio files are shipped, so sound works offline and costs no bandwidth.
import { usePrefs } from '../state/app';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  const volume = usePrefs.getState().volume;
  if (volume <= 0) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    master!.gain.value = volume * 0.5;
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

interface Note {
  f: number;
  to?: number;
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
}

function play(notes: Note[]) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + 0.01;
  for (const n of notes) {
    const start = t0 + (n.at ?? 0);
    const dur = n.dur ?? 0.25;
    const osc = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.f, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(n.gain ?? 0.3, start + (n.attack ?? 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(a.out);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

function noise(at: number, dur: number, from: number, to: number, gain = 0.2) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + 0.01 + at;
  const buf = a.ctx.createBuffer(1, Math.ceil(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const filter = a.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(a.out);
  src.start(t0);
}

export const sfx = {
  /** Call from a user gesture so mobile browsers allow audio. */
  unlock() {
    audio();
  },
  tap() {
    play([{ f: 880, dur: 0.05, type: 'triangle', gain: 0.12 }]);
  },
  join() {
    play([
      { f: 587, dur: 0.16, type: 'triangle', gain: 0.2 },
      { f: 880, at: 0.09, dur: 0.24, type: 'triangle', gain: 0.2 },
    ]);
  },
  leave() {
    play([
      { f: 660, dur: 0.14, type: 'triangle', gain: 0.16 },
      { f: 440, at: 0.09, dur: 0.22, type: 'triangle', gain: 0.16 },
    ]);
  },
  role() {
    noise(0, 0.5, 300, 2400, 0.12);
    play([
      { f: 146.8, dur: 1.4, type: 'sine', gain: 0.3, attack: 0.08 },
      { f: 440, at: 0.32, dur: 1.2, type: 'triangle', gain: 0.16 },
      { f: 659.3, at: 0.36, dur: 1.4, type: 'sine', gain: 0.12 },
    ]);
  },
  roundStart() {
    play([
      { f: 293.7, dur: 0.3, type: 'triangle', gain: 0.22 },
      { f: 349.2, at: 0.14, dur: 0.3, type: 'triangle', gain: 0.22 },
      { f: 440, at: 0.28, dur: 0.3, type: 'triangle', gain: 0.22 },
      { f: 587.3, at: 0.42, dur: 0.7, type: 'triangle', gain: 0.24 },
      { f: 146.8, at: 0.42, dur: 0.9, type: 'sine', gain: 0.22 },
    ]);
  },
  tick(urgent = false) {
    play([{ f: urgent ? 1320 : 990, dur: 0.045, type: 'square', gain: urgent ? 0.09 : 0.05 }]);
  },
  turn() {
    play([
      { f: 523.3, dur: 0.18, type: 'sine', gain: 0.2 },
      { f: 784, at: 0.07, dur: 0.3, type: 'sine', gain: 0.16 },
    ]);
  },
  clue() {
    noise(0, 0.08, 2000, 4000, 0.06);
    play([{ f: 698.5, dur: 0.2, type: 'triangle', gain: 0.16 }]);
  },
  vote() {
    noise(0, 0.07, 900, 300, 0.2);
    play([{ f: 196, to: 82, dur: 0.22, type: 'sine', gain: 0.4 }]);
  },
  votingOpen() {
    play([
      { f: 220, dur: 0.5, type: 'sawtooth', gain: 0.07 },
      { f: 233.1, at: 0.25, dur: 0.6, type: 'sawtooth', gain: 0.07 },
      { f: 110, dur: 0.9, type: 'sine', gain: 0.25 },
    ]);
  },
  eliminate() {
    noise(0, 0.35, 1800, 200, 0.14);
    play([{ f: 392, to: 73, dur: 0.7, type: 'triangle', gain: 0.28 }]);
  },
  caught() {
    noise(0, 0.25, 500, 5000, 0.14);
    play([
      { f: 523.3, dur: 0.22, type: 'triangle', gain: 0.24 },
      { f: 659.3, at: 0.11, dur: 0.22, type: 'triangle', gain: 0.24 },
      { f: 784, at: 0.22, dur: 0.22, type: 'triangle', gain: 0.24 },
      { f: 1046.5, at: 0.33, dur: 1.0, type: 'triangle', gain: 0.26 },
      { f: 261.6, at: 0.33, dur: 1.2, type: 'sine', gain: 0.24 },
      { f: 1318.5, at: 0.4, dur: 1.0, type: 'sine', gain: 0.1 },
    ]);
  },
  escaped() {
    noise(0, 0.9, 2400, 120, 0.14);
    play([
      { f: 110, dur: 1.8, type: 'sawtooth', gain: 0.1, attack: 0.1 },
      { f: 130.8, dur: 1.8, type: 'sawtooth', gain: 0.08, attack: 0.1 },
      { f: 155.6, at: 0.1, dur: 1.7, type: 'sawtooth', gain: 0.07, attack: 0.1 },
      { f: 622.3, to: 311.1, at: 0.25, dur: 1.1, type: 'sine', gain: 0.16 },
      { f: 55, dur: 2, type: 'sine', gain: 0.3, attack: 0.05 },
    ]);
  },
  victory() {
    const seq = [523.3, 659.3, 784, 1046.5, 784, 1046.5, 1318.5];
    play([
      ...seq.map((f, i) => ({ f, at: 0.5 + i * 0.12, dur: i === seq.length - 1 ? 0.9 : 0.18, type: 'triangle' as const, gain: 0.2 })),
      { f: 261.6, at: 1.22, dur: 1.0, type: 'sine', gain: 0.22 },
    ]);
  },
  defeat() {
    play([
      { f: 392, at: 0.5, dur: 0.3, type: 'triangle', gain: 0.18 },
      { f: 370, at: 0.78, dur: 0.3, type: 'triangle', gain: 0.18 },
      { f: 311.1, at: 1.06, dur: 0.3, type: 'triangle', gain: 0.18 },
      { f: 261.6, at: 1.34, dur: 0.9, type: 'triangle', gain: 0.2 },
      { f: 98, at: 1.34, dur: 1.1, type: 'sine', gain: 0.22 },
    ]);
  },
  emote() {
    play([{ f: 1174.7, to: 1568, dur: 0.12, type: 'sine', gain: 0.12 }]);
  },
  error() {
    play([
      { f: 220, dur: 0.12, type: 'square', gain: 0.07 },
      { f: 185, at: 0.1, dur: 0.18, type: 'square', gain: 0.07 },
    ]);
  },
};
