// A seated character with the player's live face composited on as the head.
//
// Bodies are modelled procedurally as designer-toy figures: a lathe-turned
// torso with a real shoulder line, clothing built from fitted panels that hug
// that same surface, jointed arms with elbows and mitten hands, and fabric /
// vinyl materials. No skin is ever modelled — the only face is the player's own.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { CharacterLook } from '../../shared/types';
import { bodyOf, paletteOf } from './looks';
import { createFaceMaterial, createFaceTexture, type FaceSource } from './FaceMaterial';

export type Mood = 'idle' | 'out' | 'win' | 'lose';

/** How long an emote reaction plays on the body, in seconds. */
const REACT_SECONDS = 1.5;

/** Each character's resting expression: eye width, height, slant and spacing on the mask. */
const EYES: Record<string, { w: number; h: number; tilt: number; gap: number }> = {
  tailor: { w: 1, h: 1.25, tilt: 0, gap: 0.095 }, // composed
  nightowl: { w: 1.25, h: 1.7, tilt: 0, gap: 0.1 }, // wide awake
  sleuth: { w: 1.25, h: 0.8, tilt: -0.22, gap: 0.092 }, // narrowed, suspicious
  jester: { w: 1.1, h: 1.6, tilt: 0.3, gap: 0.1 }, // gleeful
  captain: { w: 1.2, h: 0.95, tilt: -0.1, gap: 0.09 }, // stern
  scholar: { w: 0.85, h: 1.2, tilt: 0, gap: 0.095 }, // small, behind glasses
  vault: { w: 0.7, h: 0.75, tilt: 0, gap: 0.075 }, // two unreadable dots
  phantom: { w: 1.35, h: 0.7, tilt: 0.34, gap: 0.098 }, // slanted
};

export interface CharacterProps {
  look: CharacterLook;
  seed: number;
  face: FaceSource | null;
  mirror?: boolean;
  speaking?: boolean;
  active?: boolean;
  mood?: Mood;
  dim?: boolean;
  reactAt?: number;
  /** Which emote the reaction at `reactAt` was. */
  react?: string;
  /** Local yaw toward whoever is speaking, so heads turn to follow the table. */
  attendYaw?: number;
  still?: boolean;
  shadows?: boolean;
}

const damp = THREE.MathUtils.damp;
const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const q = new THREE.Quaternion();
const WHITE = new THREE.Color('#ffffff');

/** Height of the head centre above the character origin. Labels anchor to this. */
export const headHeight = (look: CharacterLook) => 0.58 * bodyOf(look).tall + 0.62;

type MatKey = 'primary' | 'shade' | 'lift' | 'secondary' | 'accent' | 'dark' | 'collar' | 'cape';
interface Panel {
  geo: THREE.BufferGeometry;
  mat: MatKey;
}
interface Stud {
  pos: [number, number, number];
  r: number;
  mat: MatKey;
}

/** Builds the torso surface and everything that is tailored onto it. */
function buildBody(id: string, style: string, sh: number, g: number, tall: number) {
  const dg = g - 1;
  const curve = new THREE.SplineCurve([
    new THREE.Vector2(0.275 + 0.08 * dg, 0),
    new THREE.Vector2(0.318 + 0.13 * dg, 0.07),
    new THREE.Vector2(0.338 + 0.17 * dg, 0.22),
    new THREE.Vector2(0.346 + 0.1 * dg, 0.38),
    new THREE.Vector2(0.37 + 0.03 * dg, 0.5),
    new THREE.Vector2(0.362, 0.565),
    new THREE.Vector2(0.305, 0.622),
    new THREE.Vector2(0.2, 0.662),
    new THREE.Vector2(0.128, 0.692),
    new THREE.Vector2(0.106, 0.74),
    new THREE.Vector2(0.1, 0.8),
  ]);
  const profile = curve.getPoints(44);
  const sx = 1.12 * sh;
  const sz = 0.74;

  const rAt = (y: number) => {
    for (let i = 1; i < profile.length; i++) {
      if (profile[i].y >= y) {
        const a = profile[i - 1];
        const b = profile[i];
        const t = (y - a.y) / Math.max(1e-5, b.y - a.y);
        return a.x + (b.x - a.x) * Math.min(1, Math.max(0, t));
      }
    }
    return profile[profile.length - 1].x;
  };
  /** A point on the finished (scaled) torso surface. phi 0 = chest centre. */
  const surf = (y: number, phi: number, k = 1): [number, number, number] => {
    const r = rAt(y) * k;
    return [r * Math.sin(phi) * sx, y * tall, r * Math.cos(phi) * sz];
  };
  /** A panel that follows the torso between two heights and two angles. */
  const shell = (y0: number, y1: number, phi0: number, len: number, k: number): THREE.BufferGeometry => {
    const pts = [new THREE.Vector2(rAt(y0) * k, y0), ...profile.filter((p) => p.y > y0 && p.y < y1).map((p) => new THREE.Vector2(p.x * k, p.y)), new THREE.Vector2(rAt(y1) * k, y1)];
    return new THREE.LatheGeometry(pts, Math.max(4, Math.ceil(len * 9)), phi0, len);
  };
  const flare = (pts: [number, number][], phi0: number, len: number) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28, phi0, len);

  const panels: Panel[] = [{ geo: new THREE.LatheGeometry(profile, 48), mat: 'primary' }];
  const studs: Stud[] = [];
  const add = (geo: THREE.BufferGeometry, mat: MatKey) => panels.push({ geo, mat });

  if (style === 'suit') {
    add(shell(0.25, 0.705, -0.2, 0.4, 1.012), 'secondary'); // shirt
    add(shell(0.27, 0.665, -0.045, 0.09, 1.032), 'accent'); // tie
    add(shell(0.3, 0.712, 0.2, 0.2, 1.03), 'shade'); // lapels
    add(shell(0.3, 0.712, -0.4, 0.2, 1.03), 'shade');
    add(shell(0.44, 0.475, 0.56, 0.2, 1.02), 'accent'); // pocket square
    studs.push({ pos: surf(0.2, 0, 1.03), r: 0.02, mat: 'dark' }, { pos: surf(0.12, 0, 1.03), r: 0.02, mat: 'dark' });
  } else if (style === 'hoodie') {
    add(shell(0, 0.05, 0, TAU, 1.02), 'shade'); // ribbed hem
    add(shell(0.07, 0.22, -0.5, 1.0, 1.022), 'shade'); // pouch pocket
    add(shell(0.1, 0.7, -0.013, 0.026, 1.034), 'secondary'); // zip
    studs.push({ pos: surf(0.5, 0.12, 1.04), r: 0.018, mat: 'secondary' }, { pos: surf(0.5, -0.12, 1.04), r: 0.018, mat: 'secondary' });
  } else if (style === 'trench') {
    add(shell(0, 0.68, -0.12, 0.62, 1.018), 'lift'); // double-breasted flap
    add(shell(0.2, 0.27, 0, TAU, 1.034), 'dark'); // belt
    add(flare([[0.16, 0.63], [0.19, 0.73], [0.25, 0.86]], 0.5, TAU - 1.0), 'collar');
    for (const y of [0.36, 0.46, 0.56]) for (const phi of [0.02, 0.36]) studs.push({ pos: surf(y, phi, 1.035), r: 0.022, mat: 'dark' });
    studs.push({ pos: surf(0.235, 0.18, 1.06), r: 0.035, mat: 'accent' });
  } else if (style === 'ruff') {
    add(shell(0, 0.61, 0, Math.PI, 1.012), 'secondary'); // harlequin half
    for (const [i, y] of [0.5, 0.34, 0.18].entries()) studs.push({ pos: surf(y, 0, 1.05), r: 0.05 - i * 0.002, mat: 'accent' });
  } else if (style === 'uniform') {
    add(shell(0.24, 0.66, -0.3, 0.6, 1.012), 'shade'); // plastron
    add(shell(0.655, 0.75, 0, TAU, 1.22), 'accent'); // collar band
    add(shell(0.14, 0.2, 0, TAU, 1.03), 'secondary'); // belt
    for (const y of [0.3, 0.42, 0.54]) for (const phi of [-0.23, 0.23]) studs.push({ pos: surf(y, phi, 1.03), r: 0.024, mat: 'accent' });
    studs.push({ pos: surf(0.17, 0, 1.06), r: 0.036, mat: 'accent' });
  } else if (style === 'knit') {
    add(shell(0, 0.055, 0, TAU, 1.02), 'shade');
    add(shell(0.3, 0.36, 0, TAU, 1.012), 'secondary'); // stripes
    add(shell(0.4, 0.43, 0, TAU, 1.012), 'accent');
    add(shell(0.2, 0.23, 0, TAU, 1.012), 'accent');
  } else if (style === 'cloak') {
    add(flare([[0.52, -0.02], [0.47, 0.3], [0.4, 0.52], [0.31, 0.63], [0.2, 0.68]], 0.42, TAU - 0.84), 'cape');
    add(flare([[0.17, 0.64], [0.21, 0.76], [0.3, 0.94]], 0.6, TAU - 1.2), 'collar');
    studs.push({ pos: surf(0.655, 0, 1.25), r: 0.04, mat: 'accent' });
  }
  // ---- the small details that make each character their own ----
  if (id === 'tailor') {
    studs.push({ pos: surf(0.585, 0.33, 1.06), r: 0.028, mat: 'accent' }); // boutonnière
  } else if (id === 'vault') {
    for (let k = 0; k <= 5; k++) studs.push({ pos: surf(0.31 - Math.sin((k / 5) * Math.PI) * 0.05, -0.34 + k * 0.07, 1.035), r: 0.014, mat: 'accent' }); // watch chain
  } else if (id === 'sleuth') {
    add(shell(0.5, 0.615, -0.95, 0.62, 1.03), 'shade'); // storm flap
  } else if (id === 'jester') {
    for (const [y, phi] of [[0.44, 0.75], [0.3, 1.1], [0.16, 0.75], [0.3, 0.42]]) studs.push({ pos: surf(y, phi, 1.03), r: 0.03, mat: 'primary' }); // harlequin dots
  } else if (id === 'captain') {
    add(shell(0.5, 0.535, 0.2, 0.24, 1.035), 'secondary'); // ribbon bar
    studs.push({ pos: surf(0.465, 0.26, 1.05), r: 0.022, mat: 'accent' }, { pos: surf(0.465, 0.38, 1.05), r: 0.022, mat: 'accent' }); // medals
  } else if (id === 'scholar') {
    add(shell(0.46, 0.545, 0.26, 0.24, 1.022), 'shade'); // chest pocket
    studs.push({ pos: surf(0.555, 0.34, 1.045), r: 0.016, mat: 'accent' }, { pos: surf(0.555, 0.41, 1.045), r: 0.016, mat: 'dark' }); // pens
  }
  return { panels, studs, sx, sz, surf, shoulderX: 0.372 * sx };
}

export function Character({ look, seed, face, mirror, speaking, active, mood = 'idle', dim, reactAt, react, attendYaw, still, shadows }: CharacterProps) {
  const body = bodyOf(look);
  const pal = paletteOf(look);
  const { shoulders: sh, girth: g, tall, style } = body;
  const built = useMemo(() => buildBody(body.id, style, sh, g, tall), [body.id, style, sh, g, tall]);
  useEffect(() => () => built.panels.forEach((p) => p.geo.dispose()), [built]);
  const { sx, sz, surf, shoulderX } = built;
  const shoulderY = 0.58 * tall;
  const headY = shoulderY + 0.62;

  const root = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const elbowL = useRef<THREE.Group>(null!);
  const elbowR = useRef<THREE.Group>(null!);
  const faceMesh = useRef<THREE.Mesh>(null!);
  const mask = useRef<THREE.Group>(null!);
  const eyes = useRef<THREE.Group>(null!);
  const anim = useRef({ lean: 0, arm: -0.5, elbow: -1.1, fade: 0, grey: 0, sink: 0, win: 0, yaw: 0, jolt: 0, mood: mood as Mood });

  const mats = useMemo(() => {
    const primary = new THREE.Color(pal.primary);
    const cloth = (color: THREE.Color | string, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => {
      const c = new THREE.Color(color);
      return new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.82, metalness: 0, sheen: 0.45, sheenRoughness: 0.6, sheenColor: c.clone().lerp(WHITE, 0.25), ...extra });
    };
    return {
      primary: cloth(primary),
      shade: cloth(primary.clone().multiplyScalar(0.66)),
      lift: cloth(primary.clone().lerp(WHITE, 0.16)),
      secondary: cloth(pal.secondary),
      accent: new THREE.MeshPhysicalMaterial({ color: pal.accent, roughness: 0.3, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      dark: new THREE.MeshPhysicalMaterial({ color: '#1b1630', roughness: 0.45, clearcoat: 0.5 }),
      collar: cloth(primary.clone().lerp(WHITE, 0.1), { side: THREE.DoubleSide }),
      cape: cloth(primary.clone().multiplyScalar(0.55), { side: THREE.DoubleSide }),
      vinyl: new THREE.MeshPhysicalMaterial({ color: '#f4ede0', roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
      visor: new THREE.MeshPhysicalMaterial({ color: '#17122a', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, metalness: 0.2 }),
      eye: new THREE.MeshBasicMaterial({ color: pal.accent, toneMapped: false }),
      glow: new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 1.8, roughness: 0.3 }),
    };
  }, [pal.primary, pal.secondary, pal.accent]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const faceMat = useMemo(() => createFaceMaterial(), []);
  useEffect(() => () => faceMat.dispose(), [faceMat]);

  // Bind the live face texture (local canvas or remote WebRTC video).
  const source = face ? (face.kind === 'canvas' ? face.canvas : face.el) : null;
  const texture = useMemo(() => (face ? createFaceTexture(face) : null), [source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    faceMat.uniforms.map.value = texture;
    return () => {
      faceMat.uniforms.map.value = null;
      texture?.dispose();
    };
  }, [texture, faceMat]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const a = anim.current;
    const m = still ? 0.2 : 1;
    const t = state.clock.elapsedTime + seed * 40;
    const out = mood === 'out';
    const win = mood === 'win';
    const lose = mood === 'lose';

    // Is there a real face to show right now?
    let ready = false;
    if (face && texture) {
      if (face.kind === 'canvas') {
        ready = face.live();
        if (ready) texture.needsUpdate = true;
      } else {
        ready = face.el.readyState >= 2 && face.el.videoWidth > 0;
      }
    }
    a.fade = damp(a.fade, ready ? 1 : 0, 7, dt);
    a.grey = damp(a.grey, out || dim ? 1 : 0, 4, dt);
    faceMat.uniforms.fade.value = a.fade;
    faceMat.uniforms.grey.value = a.grey;
    faceMat.uniforms.mirror.value = mirror ? 1 : 0;
    faceMat.uniforms.enhance.value = look.enhance ? 1 : 0;
    faceMesh.current.visible = a.fade > 0.01;
    const maskScale = 1 - a.fade;
    mask.current.visible = maskScale > 0.02;
    mask.current.scale.setScalar(Math.max(0.001, maskScale));

    // ---- a short reaction (from an emote), as an envelope that rises and falls ----
    let rx = 0; // 0..1 strength of the current reaction
    let re = 0; // seconds since it started
    if (reactAt && react) {
      re = (Date.now() - reactAt) / 1000;
      if (re >= 0 && re < REACT_SECONDS) rx = Math.sin((re / REACT_SECONDS) * Math.PI) * m;
    }
    const is = (name: string) => (react === name ? rx : 0);
    const laugh = is('laugh'), gasp = is('gasp'), think = is('think'), sus = is('sus'), clap = is('clap'), heart = is('heart');

    // A jolt when the mood flips (caught, won, lost) so the change lands as a beat.
    if (a.mood !== mood) {
      a.mood = mood;
      a.jolt = mood === 'idle' ? 0 : 1;
    }
    a.jolt = damp(a.jolt, 0, 2.2, dt);
    const jolt = a.jolt * m;

    // ---- posture ----
    a.lean = damp(a.lean, (active ? 0.1 : out ? -0.2 : lose ? 0.12 : 0) + sus * 0.16 - gasp * 0.2 - laugh * 0.08, 5, dt);
    a.sink = damp(a.sink, out ? -0.08 : lose ? -0.05 : 0, 3, dt);
    a.arm = damp(a.arm, win ? -2.75 : out ? -0.12 : lose ? -0.2 : active ? -0.62 : -0.5, win ? 7 : 4, dt);
    a.elbow = damp(a.elbow, win ? -0.3 : out ? -0.7 : lose ? -0.75 : active ? -1.2 : -1.12, win ? 7 : 4, dt);

    const bounce = win ? Math.abs(Math.sin(t * 6.5)) * 0.07 * m : 0;
    const giggle = laugh * Math.abs(Math.sin(re * 20)) * 0.035 + heart * Math.abs(Math.sin(re * 7)) * 0.03 + gasp * 0.03;
    const wobble = out ? Math.sin(t * 34) * 0.1 * jolt : 0; // caught: a startled shudder
    root.current.position.y = a.sink + bounce + giggle + (win ? jolt * 0.1 : 0);
    root.current.rotation.x = a.lean;
    root.current.rotation.z = Math.sin(t * 0.6) * 0.016 * m + wobble + heart * Math.sin(re * 8) * 0.09;
    // Winners give a little twirl as the result lands.
    root.current.rotation.y = win ? jolt * jolt * Math.PI * 2 : 0;
    torso.current.scale.y = 1 + Math.sin(t * 1.7) * 0.012 * m; // breathing

    // ---- head: look at whoever is speaking, otherwise glance around the table ----
    const idleYaw = (Math.sin(t * 0.23 + seed * 5) * 0.2 + Math.sin(t * 0.61 + seed * 13) * 0.08) * m;
    const yawTarget = attendYaw !== undefined && !out && !lose ? THREE.MathUtils.clamp(attendYaw, -0.75, 0.75) + idleYaw * 0.25 : idleYaw;
    a.yaw = damp(a.yaw, yawTarget, 3.5, dt);
    const talk = speaking ? Math.abs(Math.sin(t * 10)) : 0;
    const shake = lose ? Math.sin(t * 5.5) * 0.16 * Math.max(jolt, 0.25) : 0; // a slow "no…"
    head.current.position.y = headY + talk * 0.02 * m + Math.sin(t * 1.7) * 0.006 * m;
    head.current.rotation.y = a.yaw + shake + sus * Math.sin(re * 6) * 0.4;
    head.current.rotation.z = Math.sin(t * 0.45 + seed * 6) * 0.05 * m + (out ? 0.22 : 0) + think * 0.3;
    head.current.rotation.x = (out ? 0.25 : lose ? 0.32 : Math.sin(t * 0.33 + seed * 9) * 0.03 * m) - laugh * 0.28 - gasp * 0.16 + think * 0.08;
    head.current.scale.setScalar(1 + talk * 0.015 + gasp * 0.05);
    torso.current.rotation.y = a.yaw * 0.22;

    // ---- the mask's eyes: blinking, plus an expression for what is happening ----
    const blink = (t * 0.37 + seed * 3) % 1 > 0.965 ? 0.12 : 1;
    const expr = out ? 0.18 : lose ? 0.3 : win ? 0.5 : 1;
    const openness = blink * expr * (1 - laugh * 0.6 - sus * 0.65 - think * 0.35 - heart * 0.45) * (1 + gasp * 0.55);
    eyes.current.scale.y = damp(eyes.current.scale.y, Math.max(0.1, openness), 28, dt);
    eyes.current.scale.x = damp(eyes.current.scale.x, 1 + gasp * 0.25 + (win ? 0.12 : 0), 20, dt);
    eyes.current.rotation.z = damp(eyes.current.rotation.z, sus * 0.18, 12, dt);

    // ---- arms ----
    const sway = Math.sin(t * 0.9) * 0.025 * m;
    const cheer = win ? Math.sin(t * 9) * 0.14 : 0;
    // When cheering, arms go up and out so they never cross the face.
    a.win = damp(a.win, win ? 1 : 0, 6, dt);
    const clapIn = clap * (0.42 + Math.sin(re * 24) * 0.2); // hands meet in front
    armL.current.rotation.z = -(0.3 + a.win * 0.95 + gasp * 0.5) + clapIn;
    armR.current.rotation.z = 0.3 + a.win * 0.95 + gasp * 0.5 - clapIn;
    armL.current.rotation.x = a.arm + sway + cheer - gasp * 1.0 - clap * 0.55;
    armR.current.rotation.x = a.arm - sway - cheer + (speaking ? Math.sin(t * 5) * 0.12 * m : 0) - gasp * 1.0 - clap * 0.55 - think * 0.75;
    elbowL.current.rotation.x = a.elbow - clap * 0.25;
    elbowR.current.rotation.x = a.elbow + (speaking ? Math.sin(t * 5 + 1) * 0.16 * m : 0) - clap * 0.25 - think * 1.0;

    // Billboard: the live face always looks at the viewer, whatever seat it is in.
    head.current.getWorldQuaternion(q).invert();
    faceMesh.current.quaternion.copy(q.multiply(state.camera.quaternion));
  });

  const sleeve = (side: 1 | -1) => (style === 'ruff' && side === 1 ? mats.secondary : mats.primary);
  const cuff = style === 'uniform' || style === 'ruff' ? mats.accent : style === 'hoodie' || style === 'knit' ? mats.shade : mats.secondary;
  const glove = style === 'cloak' ? mats.dark : mats.vinyl;
  const armR0 = 0.088 + 0.012 * g;

  const arm = (side: 1 | -1, ref: React.RefObject<THREE.Group>, elbow: React.RefObject<THREE.Group>) => (
    <group ref={ref} position={[side * (shoulderX - 0.035), shoulderY - 0.045, 0]} rotation={[-0.5, 0, side * 0.3]}>
      <mesh material={sleeve(side)} castShadow={shadows}>
        <sphereGeometry args={[armR0 + 0.03, 20, 16]} />
      </mesh>
      <mesh material={sleeve(side)} position={[0, -0.17, 0]} castShadow={shadows}>
        <capsuleGeometry args={[armR0 + 0.008, 0.22, 6, 14]} />
      </mesh>
      <group ref={elbow} position={[0, -0.33, 0]} rotation={[-1.12, 0, side * -0.5]}>
        <mesh material={sleeve(side)}>
          <sphereGeometry args={[armR0 + 0.006, 16, 12]} />
        </mesh>
        <mesh material={sleeve(side)} position={[0, -0.14, 0]} castShadow={shadows}>
          <capsuleGeometry args={[armR0 - 0.004, 0.19, 6, 14]} />
        </mesh>
        <mesh material={cuff} position={[0, -0.275, 0]}>
          <cylinderGeometry args={[armR0 + 0.012, armR0 + 0.006, 0.055, 18]} />
        </mesh>
        {/* mitten hand */}
        <group position={[0, -0.365, 0]}>
          <mesh material={glove} scale={[1, 1.12, 0.82]} castShadow={shadows}>
            <sphereGeometry args={[0.088, 20, 16]} />
          </mesh>
          <mesh material={glove} position={[side * -0.068, 0.012, 0.022]} scale={[0.9, 1.2, 0.9]}>
            <sphereGeometry args={[0.036, 12, 10]} />
          </mesh>
        </group>
      </group>
    </group>
  );

  const id = body.id;
  const eye = EYES[id] ?? EYES.tailor;
  const scarfAt = surf(0.5, 0.42, 1.06);

  return (
    <group ref={root}>
      <group ref={torso}>
        <group scale={[sx, tall, sz]}>
          {built.panels.map((p, i) => (
            <mesh key={i} geometry={p.geo} material={mats[p.mat]} castShadow={shadows && i === 0} />
          ))}
        </group>
        {built.studs.map((s, i) => (
          <mesh key={i} position={s.pos} material={mats[s.mat]}>
            <sphereGeometry args={[s.r, 12, 10]} />
          </mesh>
        ))}

        {style === 'hoodie' && (
          <mesh material={mats.lift} position={[0, shoulderY + 0.15, -0.11]} rotation={[1.2, 0, 0]} scale={[1.05, 1, 1]}>
            <torusGeometry args={[0.2, 0.1, 14, 28]} />
          </mesh>
        )}
        {/* the night owl wears headphones round the neck */}
        {id === 'nightowl' && (
          <group position={[0, shoulderY + 0.17, 0.0]}>
            <mesh material={mats.dark} rotation={[HALF_PI, 0, Math.PI]} position={[0, 0, 0.02]}>
              <torusGeometry args={[0.17, 0.018, 8, 24, Math.PI]} />
            </mesh>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.17, -0.01, 0.05]} rotation={[0, 0, HALF_PI]}>
                <mesh material={mats.dark}>
                  <cylinderGeometry args={[0.062, 0.062, 0.05, 18]} />
                </mesh>
                <mesh material={mats.accent} position={[0, s * -0.028, 0]}>
                  <cylinderGeometry args={[0.04, 0.04, 0.012, 18]} />
                </mesh>
              </group>
            ))}
          </group>
        )}
        {style === 'knit' && (
          <mesh material={mats.lift} position={[0, shoulderY + 0.13, 0]} rotation={[HALF_PI, 0, 0]}>
            <torusGeometry args={[0.125, 0.055, 12, 28]} />
          </mesh>
        )}
        {style === 'ruff' &&
          Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * TAU;
            return (
              <mesh key={i} material={i % 2 ? mats.accent : mats.secondary} position={[Math.sin(a) * 0.21, shoulderY + 0.1, Math.cos(a) * 0.18]} scale={[1, 0.8, 1]}>
                <sphereGeometry args={[0.08, 14, 10]} />
              </mesh>
            );
          })}
        {style === 'uniform' &&
          [-1, 1].map((s) => (
            <group key={s} position={[s * shoulderX * 0.86, shoulderY + 0.035, 0]} rotation={[0, 0, s * -0.22]}>
              <mesh material={mats.accent} scale={[1, 0.3, 0.75]}>
                <sphereGeometry args={[0.1, 16, 10]} />
              </mesh>
            </group>
          ))}

        {look.accessory === 'bowtie' && (
          <group position={[0, shoulderY + 0.115, 0.125]}>
            {[-1, 1].map((s) => (
              <mesh key={s} material={mats.accent} position={[s * 0.062, 0, 0]} rotation={[0, 0, s * HALF_PI]} scale={[1, 1, 0.6]}>
                <coneGeometry args={[0.062, 0.12, 14]} />
              </mesh>
            ))}
            <mesh material={mats.accent}>
              <sphereGeometry args={[0.03, 12, 10]} />
            </mesh>
          </group>
        )}
        {look.accessory === 'scarf' && (
          <>
            <mesh material={mats.accent} position={[0, shoulderY + 0.12, 0]} rotation={[HALF_PI, 0, 0]} scale={[1.08, 1, 1]}>
              <torusGeometry args={[0.13, 0.07, 12, 28]} />
            </mesh>
            <mesh material={mats.accent} position={[scarfAt[0], shoulderY - 0.1, scarfAt[2]]} rotation={[0.1, 0.42, -0.1]}>
              <capsuleGeometry args={[0.055, 0.2, 6, 12]} />
            </mesh>
          </>
        )}
        {look.accessory === 'pin' && (
          <mesh material={mats.glow} position={surf(0.5, -0.55, 1.05)} rotation={[0, -0.55, 0.6]}>
            <octahedronGeometry args={[0.042]} />
          </mesh>
        )}
      </group>

      {arm(-1, armL, elbowL)}
      {arm(1, armR, elbowR)}

      <group ref={head} position={[0, headY, 0]}>
        {/* a raised hood sits behind the head and frames a live face just as well as the mask */}
        {id === 'phantom' && (
          <mesh material={mats.cape} position={[0, 0, -0.04]} rotation={[0.12, Math.PI, 0]} scale={[1, 1.08, 1]}>
            <sphereGeometry args={[0.37, 28, 20, HALF_PI + 0.95, TAU - 1.9, 0, 2.4]} />
          </mesh>
        )}

        {/* the live face: real camera pixels, background removed */}
        <mesh ref={faceMesh} material={faceMat} position={[0, 0.03, 0.06]} renderOrder={2}>
          <planeGeometry args={[1.08, 1.08]} />
        </mesh>

        {/* camera-off head: a vinyl mask with a glossy visor and two glowing eyes */}
        <group ref={mask} position={[0, -0.03, 0]}>
          <mesh material={mats.vinyl} scale={[1, 1.06, 0.96]} castShadow={shadows}>
            <sphereGeometry args={[0.27, 36, 28]} />
          </mesh>
          <mesh material={mats.visor} scale={[1, 1.06, 0.96]}>
            <sphereGeometry args={[0.277, 36, 16, HALF_PI - 1.0, 2.0, 1.02, 0.9]} />
          </mesh>
          <group ref={eyes} position={[0, 0.015, 0.262]}>
            {[-1, 1].map((s) => (
              <mesh key={s} material={mats.eye} position={[s * eye.gap, 0, -0.012]} rotation={[0, 0, s * eye.tilt]} scale={[eye.w, eye.h * (id === 'jester' && s === 1 ? 0.55 : 1), 0.35]}>
                <sphereGeometry args={[0.033, 14, 12]} />
              </mesh>
            ))}
          </group>
          {/* the jester never stops grinning */}
          {id === 'jester' && (
            <mesh material={mats.eye} position={[0, -0.075, 0.262]} rotation={[0, 0, Math.PI + 0.55]}>
              <torusGeometry args={[0.07, 0.011, 8, 20, Math.PI - 1.1]} />
            </mesh>
          )}

          {id === 'tailor' && (
            <mesh material={mats.dark} position={[0, 0.03, -0.025]} rotation={[-0.25, 0, 0]} scale={[1.03, 1.08, 1]}>
              <sphereGeometry args={[0.275, 30, 16, 0, TAU, 0, 1.15]} />
            </mesh>
          )}
          {id === 'nightowl' &&
            [-1, 1].map((s) => (
              <mesh key={s} material={mats.primary} position={[s * 0.15, 0.27, -0.02]} rotation={[0, 0, s * -0.4]}>
                <coneGeometry args={[0.07, 0.17, 14]} />
              </mesh>
            ))}
          {id === 'sleuth' && (
            <group position={[0, 0.17, 0]} rotation={[-0.08, 0, 0.06]}>
              <mesh material={mats.shade} scale={[1, 0.12, 1]}>
                <sphereGeometry args={[0.4, 30, 12]} />
              </mesh>
              <mesh material={mats.shade} position={[0, 0.1, 0]}>
                <cylinderGeometry args={[0.2, 0.235, 0.2, 28]} />
              </mesh>
              <mesh material={mats.accent} position={[0, 0.04, 0]}>
                <cylinderGeometry args={[0.24, 0.242, 0.05, 28]} />
              </mesh>
            </group>
          )}
          {id === 'jester' &&
            [-1, 1].map((s) => (
              <group key={s} position={[s * 0.15, 0.2, 0]} rotation={[0, 0, s * -0.75]}>
                <mesh material={s === 1 ? mats.secondary : mats.primary} position={[0, 0.14, 0]}>
                  <coneGeometry args={[0.1, 0.34, 16]} />
                </mesh>
                <mesh material={mats.accent} position={[0, 0.33, 0]}>
                  <sphereGeometry args={[0.045, 12, 10]} />
                </mesh>
              </group>
            ))}
          {id === 'captain' && (
            <group position={[0, 0.2, 0]} rotation={[-0.1, 0, 0]}>
              <mesh material={mats.primary}>
                <cylinderGeometry args={[0.25, 0.245, 0.09, 28]} />
              </mesh>
              <mesh material={mats.secondary} position={[0, 0.075, 0]} scale={[1, 0.3, 1]}>
                <sphereGeometry args={[0.31, 28, 12]} />
              </mesh>
              <mesh material={mats.dark} position={[0, -0.035, 0.2]} scale={[1, 0.12, 0.7]}>
                <sphereGeometry args={[0.2, 20, 10]} />
              </mesh>
              <mesh material={mats.accent} position={[0, 0.01, 0.25]}>
                <sphereGeometry args={[0.035, 12, 10]} />
              </mesh>
            </group>
          )}
          {id === 'scholar' && (
            <>
              {[-1, 1].map((s) => (
                <mesh key={s} material={mats.accent} position={[s * 0.095, 0.015, 0.275]} rotation={[0, s * 0.3, 0]}>
                  <torusGeometry args={[0.07, 0.011, 8, 24]} />
                </mesh>
              ))}
              <mesh material={mats.primary} position={[0, 0.16, -0.01]} scale={[1.04, 0.72, 1.02]}>
                <sphereGeometry args={[0.275, 28, 14, 0, TAU, 0, HALF_PI]} />
              </mesh>
              <mesh material={mats.accent} position={[0, 0.37, -0.01]}>
                <sphereGeometry args={[0.05, 12, 10]} />
              </mesh>
            </>
          )}
          {id === 'vault' && (
            <group position={[0, 0.19, 0]}>
              <mesh material={mats.dark} scale={[1, 0.1, 1]}>
                <sphereGeometry args={[0.35, 28, 10]} />
              </mesh>
              <mesh material={mats.dark} scale={[1, 0.85, 1]}>
                <sphereGeometry args={[0.24, 28, 14, 0, TAU, 0, HALF_PI]} />
              </mesh>
            </group>
          )}
        </group>

        {look.accessory === 'tophat' && (
          <group position={[0.02, 0.36, -0.02]} rotation={[0, 0, -0.12]}>
            <mesh material={mats.dark} scale={[1, 0.1, 1]}>
              <sphereGeometry args={[0.3, 28, 10]} />
            </mesh>
            <mesh material={mats.dark} position={[0, 0.17, 0]}>
              <cylinderGeometry args={[0.19, 0.175, 0.32, 28]} />
            </mesh>
            <mesh material={mats.accent} position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.181, 0.179, 0.055, 28]} />
            </mesh>
          </group>
        )}
        {look.accessory === 'halo' && (
          <mesh material={mats.glow} position={[0, 0.5, 0]} rotation={[HALF_PI + 0.14, 0, 0]}>
            <torusGeometry args={[0.2, 0.02, 10, 44]} />
          </mesh>
        )}
        {look.accessory === 'crown' && (
          <group position={[0, 0.39, 0]} rotation={[0, 0, 0.08]}>
            <mesh material={mats.accent}>
              <cylinderGeometry args={[0.2, 0.18, 0.09, 28, 1, true]} />
            </mesh>
            {Array.from({ length: 7 }, (_, i) => {
              const a = (i / 7) * TAU;
              return (
                <group key={i} position={[Math.sin(a) * 0.195, 0.085, Math.cos(a) * 0.195]}>
                  <mesh material={mats.accent}>
                    <coneGeometry args={[0.038, 0.1, 8]} />
                  </mesh>
                  <mesh material={mats.glow} position={[0, 0.06, 0]}>
                    <sphereGeometry args={[0.02, 8, 8]} />
                  </mesh>
                </group>
              );
            })}
          </group>
        )}
      </group>
    </group>
  );
}
