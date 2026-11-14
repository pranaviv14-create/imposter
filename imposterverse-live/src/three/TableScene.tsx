// The game room: a lacquered round table under a halo light, in a lounge of
// softly lit arches. Players sit around the far arc so every live face is
// turned toward the viewer.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterLook } from '../../shared/types';
import { Character, headHeight, type Mood } from './Character';
import type { FaceSource } from './FaceMaterial';

export interface Seat {
  id: string;
  look: CharacterLook;
  seed: number;
  face: FaceSource | null;
  mirror?: boolean;
  speaking?: boolean;
  active?: boolean;
  mood?: Mood;
  dim?: boolean;
  reactAt?: number;
  react?: string;
  label?: ReactNode;
  /** During the vote: this character can be clicked or tapped to accuse them. */
  pickable?: boolean;
  /** This character is the one currently selected. */
  picked?: boolean;
  onPick?: () => void;
}

export type Tone = 'neutral' | 'caught' | 'escaped' | 'tense';

interface SceneProps {
  seats: Seat[];
  focusId?: string | null;
  tone?: Tone;
  variant?: 'game' | 'home' | 'solo';
  /** The game phase, so the camera can stage each one differently. */
  phase?: string;
  low?: boolean;
  still?: boolean;
}

const TABLE_Y = 0.8;
const damp = THREE.MathUtils.damp;
const TAU = Math.PI * 2;

// One light language for the whole room: the halo and the table's light strip
// always show the same colour, and that colour always means the same thing.
const TONE: Record<Tone, string> = { neutral: '#ffe9cf', tense: '#b3a4ff', caught: '#7dffc4', escaped: '#ff6a8f' };

interface Layout {
  tableR: number;
  seatR: number;
  arc: number;
  spots: { x: number; z: number; rot: number }[];
}

export function layoutFor(n: number, maxArcDeg = 250): Layout {
  const tableR = Math.min(2.9, Math.max(1.65, 1.2 + n * 0.17));
  const seatR = tableR + 0.3;
  const arc = n <= 1 ? 0 : (Math.min(maxArcDeg, 20 + n * 46) * Math.PI) / 180;
  const spots = Array.from({ length: n }, (_, i) => {
    const a = n <= 1 ? 0 : -arc / 2 + (arc * i) / (n - 1);
    const x = Math.sin(a) * seatR;
    const z = -Math.cos(a) * seatR;
    return { x, z, rot: Math.atan2(-x, -z) };
  });
  return { tableR, seatR, arc, spots };
}

// ---- small procedural textures ------------------------------------------

function emblemTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.scale(4, 4); // draw the 64-unit brand mark
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };
  rr(6, 5, 52, 54, 24);
  g.fillStyle = '#f6f2ea';
  g.fill();
  g.save();
  rr(6, 5, 52, 54, 24);
  g.clip();
  g.fillStyle = '#ff6b3d';
  g.fillRect(32, 0, 40, 64);
  g.restore();
  g.fillStyle = '#16111f';
  g.beginPath();
  g.ellipse(21.5, 29, 5, 6.5, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#16111f';
  g.lineCap = 'round';
  g.lineWidth = 3.6;
  g.beginPath();
  g.moveTo(38, 30.5);
  g.quadraticCurveTo(42.5, 26, 47, 30.5);
  g.stroke();
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(24, 44);
  g.quadraticCurveTo(32, 50, 40, 44);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A tall arch, lit from the floor. */
function archTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.moveTo(8, 320);
  g.lineTo(8, 64);
  g.arc(64, 64, 56, Math.PI, 0);
  g.lineTo(120, 320);
  g.closePath();
  const grad = g.createLinearGradient(0, 320, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0.12)');
  g.fillStyle = grad;
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- environment ---------------------------------------------------------

/** Image-based lighting, so lacquer, vinyl and metal have something to reflect. */
function Reflections({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

function Room({ low, rugR }: { low?: boolean; rugR: number }) {
  const arch = useMemo(archTexture, []);
  useEffect(() => () => arch.dispose(), [arch]);
  const arches = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * TAU + TAU / 24), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[16, 64]} />
        <meshStandardMaterial color="#141027" roughness={0.22} metalness={0.35} />
      </mesh>
      {/* rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <circleGeometry args={[rugR, 64]} />
        <meshStandardMaterial color="#231d4e" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
        <ringGeometry args={[rugR - 0.16, rugR - 0.1, 96]} />
        <meshBasicMaterial color="#ff6b3d" />
      </mesh>
      {/* curved wall */}
      <mesh position={[0, 4.5, 0]}>
        <cylinderGeometry args={[11.2, 11.2, 9, 64, 1, true]} />
        <meshStandardMaterial color="#1b1636" roughness={0.95} side={THREE.BackSide} />
      </mesh>
      {arches.map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * 11, 3, Math.cos(a) * 11]} rotation={[0, a + Math.PI, 0]}>
          <planeGeometry args={[2.5, 6]} />
          <meshBasicMaterial map={arch} color={i % 3 === 0 ? '#ff6b3d' : '#7466f0'} transparent opacity={low ? 0.5 : 0.62} depthWrite={false} fog />
        </mesh>
      ))}
    </group>
  );
}

function Table({ radius, activeSpot, tone }: { radius: number; activeSpot: { x: number; z: number } | null; tone: Tone }) {
  const emblem = useMemo(emblemTexture, []);
  const glow = useMemo(glowTexture, []);
  useEffect(() => () => (emblem.dispose(), glow.dispose()), [emblem, glow]);
  const marker = useRef<THREE.Mesh>(null!);
  const strip = useRef<THREE.MeshBasicMaterial>(null!);
  const pos = useRef(new THREE.Vector3(0, 0, 0));
  const strength = useRef(0);
  const target = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    strength.current = damp(strength.current, activeSpot ? 1 : 0, 5, dt);
    if (activeSpot) {
      const len = Math.hypot(activeSpot.x, activeSpot.z) || 1;
      const r = radius - 0.66;
      pos.current.x = damp(pos.current.x, (activeSpot.x / len) * r, 6, dt);
      pos.current.z = damp(pos.current.z, (activeSpot.z / len) * r, 6, dt);
    }
    marker.current.position.set(pos.current.x, TABLE_Y + 0.014, pos.current.z);
    (marker.current.material as THREE.MeshBasicMaterial).opacity = strength.current * (0.6 + Math.sin(state.clock.elapsedTime * 3) * 0.15);
    marker.current.visible = strength.current > 0.01;
    strip.current.color.lerp(target.set(TONE[tone]), 1 - Math.exp(-4 * dt));
  });

  return (
    <group>
      {/* lacquer top with a rounded edge */}
      <mesh position={[0, TABLE_Y - 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius - 0.05, radius - 0.05, 0.1, 96]} />
        <meshPhysicalMaterial color="#251d45" roughness={0.22} clearcoat={1} clearcoatRoughness={0.08} />
      </mesh>
      <mesh position={[0, TABLE_Y - 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[radius - 0.05, 0.05, 16, 128]} />
        <meshPhysicalMaterial color="#251d45" roughness={0.22} clearcoat={1} clearcoatRoughness={0.08} />
      </mesh>
      {/* the light strip under the lip — the room's status light */}
      <mesh position={[0, TABLE_Y - 0.115, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius - 0.1, 0.018, 8, 128]} />
        <meshBasicMaterial ref={strip} color={TONE.neutral} toneMapped={false} />
      </mesh>
      {/* felt inlay */}
      <mesh position={[0, TABLE_Y + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[radius - 0.34, 96]} />
        <meshStandardMaterial color="#2b2382" roughness={1} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.37, radius - 0.34, 128]} />
        <meshBasicMaterial color="#f6f2ea" transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.007, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[Math.min(0.5, radius * 0.24), 48]} />
        <meshBasicMaterial map={emblem} transparent depthWrite={false} />
      </mesh>
      <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial map={glow} color="#ffd04f" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* pedestal */}
      <mesh position={[0, (TABLE_Y - 0.1) / 2, 0]} castShadow>
        <cylinderGeometry args={[radius * 0.2, radius * 0.34, TABLE_Y - 0.1, 48]} />
        <meshPhysicalMaterial color="#1c1636" roughness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[radius * 0.42, radius * 0.44, 0.06, 48]} />
        <meshStandardMaterial color="#ff6b3d" roughness={0.45} />
      </mesh>
      {/* the table's own shadow pooling on the rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
        <circleGeometry args={[radius * 1.25, 48]} />
        <meshBasicMaterial map={glow} color="#05030c" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** The ring on the floor around a seat: faint when it can be chosen, bright and pulsing when it is. */
function PickRing({ pickable, picked }: { pickable: boolean; picked: boolean }) {
  const ref = useRef<THREE.Mesh>(null!);
  const power = useRef(0);
  useFrame((state, dt) => {
    power.current = damp(power.current, picked ? 1 : pickable ? 0.28 : 0, 8, dt);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = power.current * (picked ? 0.85 + Math.sin(state.clock.elapsedTime * 6) * 0.15 : 1);
    ref.current.visible = power.current > 0.01;
    ref.current.scale.setScalar(1 + (picked ? Math.sin(state.clock.elapsedTime * 6) * 0.03 : 0));
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, -0.04]} visible={false}>
      <ringGeometry args={[0.62, 0.72, 48]} />
      <meshBasicMaterial color="#ff5480" transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

const CHAIR_ARC = 2.7;
function Chair({ shadow }: { shadow: THREE.Texture }) {
  return (
    <group>
      {/* contact shadow, so the chair sits on the floor instead of floating over it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.013, -0.04]}>
        <circleGeometry args={[0.85, 32]} />
        <meshBasicMaterial map={shadow} color="#05030c" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      {/* foot + stem */}
      <mesh position={[0, 0.02, -0.04]}>
        <cylinderGeometry args={[0.3, 0.32, 0.04, 28]} />
        <meshStandardMaterial color="#f6f2ea" roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.27, -0.04]}>
        <cylinderGeometry args={[0.045, 0.045, 0.5, 14]} />
        <meshStandardMaterial color="#f6f2ea" roughness={0.35} metalness={0.1} />
      </mesh>
      {/* cushion */}
      <mesh position={[0, 0.56, -0.04]} scale={[1, 0.3, 1]} castShadow>
        <sphereGeometry args={[0.43, 28, 16]} />
        <meshStandardMaterial color="#3d3470" roughness={0.9} />
      </mesh>
      {/* tub back */}
      <mesh position={[0, 0.98, -0.04]}>
        <cylinderGeometry args={[0.47, 0.42, 0.82, 28, 1, true, Math.PI - CHAIR_ARC / 2, CHAIR_ARC]} />
        <meshStandardMaterial color="#3d3470" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.39, -0.04]} rotation={[Math.PI / 2, 0, -Math.PI / 2 - CHAIR_ARC / 2]}>
        <torusGeometry args={[0.47, 0.045, 10, 28, CHAIR_ARC]} />
        <meshStandardMaterial color="#ff6b3d" roughness={0.6} />
      </mesh>
    </group>
  );
}

function Halo({ tone, focus, low, height, tableR }: { tone: Tone; focus: THREE.Vector3 | null; low?: boolean; height: number; tableR: number }) {
  const key = useRef<THREE.SpotLight>(null!);
  const follow = useRef<THREE.SpotLight>(null!);
  const up = useRef<THREE.PointLight>(null!);
  const ring = useRef<THREE.MeshBasicMaterial>(null!);
  const shaft = useRef<THREE.MeshBasicMaterial>(null!);
  const bloom = useRef<THREE.MeshBasicMaterial>(null!);
  const colour = useRef(new THREE.Color(TONE.neutral));
  const target = useMemo(() => new THREE.Color(), []);
  const followTarget = useMemo(() => new THREE.Object3D(), []);
  const followPower = useRef(0);
  const glow = useMemo(glowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const beat = useRef({ tone, flash: 0 });

  useFrame((state, dt) => {
    // The moment the verdict lands, the whole room flares and settles.
    if (beat.current.tone !== tone) {
      beat.current.tone = tone;
      if (tone === 'caught' || tone === 'escaped') beat.current.flash = 1;
    }
    beat.current.flash = damp(beat.current.flash, 0, 2.4, dt);
    const flash = beat.current.flash;
    // While the table is voting, the light breathes.
    const breath = tone === 'tense' ? 0.86 + Math.sin(state.clock.elapsedTime * 2.2) * 0.14 : 1;

    colour.current.lerp(target.set(TONE[tone]), 1 - Math.exp(-3 * dt));
    key.current.color.copy(colour.current);
    const base = tone === 'caught' ? 150 : tone === 'escaped' ? 120 : tone === 'tense' ? 95 : 120;
    key.current.intensity = damp(key.current.intensity, base * breath * (1 + flash * 1.6), 6, dt);
    ring.current.color.copy(colour.current);
    shaft.current.color.copy(colour.current);
    shaft.current.opacity = (0.022 + flash * 0.07) * breath;
    bloom.current.color.copy(colour.current);
    bloom.current.opacity = 0.2 + flash * 0.3;
    // The table's light strip throws a little of the same colour back up at the players.
    up.current.color.copy(colour.current);
    up.current.intensity = (tone === 'neutral' ? 2.2 : 5) * breath + flash * 8;

    followPower.current = damp(followPower.current, focus ? 1 : 0, 4, dt);
    if (focus) followTarget.position.lerp(focus, 1 - Math.exp(-5 * dt));
    follow.current.intensity = followPower.current * (70 + flash * 120);
  });

  return (
    <group>
      <spotLight ref={key} position={[0, height + 1, 0.4]} angle={0.95} penumbra={0.9} intensity={120} decay={2} castShadow={!low} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02} shadow-radius={6} />
      <primitive object={followTarget} />
      <spotLight ref={follow} position={[0, height, 2.6]} angle={0.24} penumbra={0.9} intensity={0} decay={2} color="#fff3dc" target={followTarget} />
      <pointLight ref={up} position={[0, TABLE_Y + 0.35, 0]} intensity={2.2} distance={tableR + 2.4} decay={1.6} />
      {/* a soft shaft of light from the halo down to the table, and the bloom around the ring */}
      <mesh position={[0, (height + TABLE_Y) / 2, 0]}>
        <cylinderGeometry args={[1.3, tableR * 0.96, height - TABLE_Y, 48, 1, true]} />
        <meshBasicMaterial ref={shaft} color={TONE.neutral} transparent opacity={0.035} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} fog={false} />
      </mesh>
      <mesh position={[0, height - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.4, 5.4]} />
        <meshBasicMaterial ref={bloom} map={glow} color={TONE.neutral} transparent opacity={0.2} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} fog={false} />
      </mesh>
      {/* halo fitting */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.05, 12, 96]} />
        <meshBasicMaterial ref={ring} color={TONE.neutral} toneMapped={false} />
      </mesh>
      <mesh position={[0, height + 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.075, 12, 96]} />
        <meshStandardMaterial color="#14102a" roughness={0.4} metalness={0.6} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * TAU + 0.5;
        return (
          <mesh key={i} position={[Math.sin(a) * 1.35, height + 2.5, Math.cos(a) * 1.35]}>
            <cylinderGeometry args={[0.008, 0.008, 5, 6]} />
            <meshBasicMaterial color="#3a3360" />
          </mesh>
        );
      })}
    </group>
  );
}

function Dust({ still }: { still?: boolean }) {
  const ref = useRef<THREE.Points>(null!);
  const geometry = useMemo(() => {
    const n = 110;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 3.6;
      const a = Math.random() * TAU;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = 0.9 + Math.random() * 3.4;
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => {
    if (still) return;
    ref.current.rotation.y += dt * 0.02;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.03;
      if (y > 4.3) y = 0.9;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial color="#fff1dc" size={0.02} transparent opacity={0.4} depthWrite={false} sizeAttenuation />
    </points>
  );
}

// ---- camera --------------------------------------------------------------

function Rig({ layout, focus, variant, still, phase }: { layout: Layout; focus: THREE.Vector3 | null; variant: string; still?: boolean; phase?: string }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 1.2, 0));
  const want = useMemo(() => new THREE.Vector3(), []);
  const wantLook = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const first = useRef(true);
  const beat = useRef<{ phase: string | undefined; at: number }>({ phase, at: 0 });

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const portrait = aspect < 0.9;
    const t = state.clock.elapsedTime;
    const fov = variant === 'solo' ? 28 : portrait ? 44 : 34;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const tanV = Math.tan((fov * Math.PI) / 360);
    const tanH = tanV * aspect;

    if (variant === 'solo') {
      // Character studio: frame the figure from hands to the top of the head.
      const d = Math.max(1.05 / tanV, 0.85 / tanH);
      want.set(still ? 0.3 : Math.sin(t * 0.3) * 0.5, 1.25, d);
      wantLook.set(0, 1.02, 0);
    } else {
      const spread = Math.min(layout.arc / 2, Math.PI / 2);
      const halfW = Math.max(layout.tableR + 0.5, layout.seatR * Math.sin(spread) + 0.9);
      let d = Math.max(halfW / tanH, layout.seatR * 1.5 + 2.6);
      const elev = portrait ? 0.4 : 0.3;
      // Aim a little above the table so there is headroom for name and clue labels.
      wantLook.set(0, variant === 'game' ? (portrait ? 1.95 : 1.6) : 1.3, -layout.seatR * 0.3);
      if (variant === 'home') {
        // Slow cinematic orbit. On wide screens the table sits to the right of the menu.
        d *= portrait ? 1.0 : 1.3;
        const orbit = still ? 0.12 : Math.sin(t * 0.07) * 0.22 + 0.1;
        if (portrait) wantLook.y -= d * tanV * 0.5; // lift the table into the top half, above the menu
        else wantLook.x -= d * tanH * 0.54;
        want.set(wantLook.x + Math.sin(orbit) * d, wantLook.y + Math.sin(elev) * d * 0.9, wantLook.z + Math.cos(orbit) * d * Math.cos(elev));
      } else {
        if (focus) {
          wantLook.lerp(tmp.set(focus.x, 1.75, focus.z), portrait ? 0.45 : 0.18);
          d *= portrait ? 0.72 : 0.92;
        }
        // Each phase is staged a little differently:
        //   roles      — a slow push in while everyone reads their card
        //   discussion — a wider, lazier drift around the table
        //   voting     — lower and closer, like leaning in
        //   reveal     — a jolt as the verdict lands
        if (beat.current.phase !== phase) {
          beat.current.phase = phase;
          beat.current.at = t;
        }
        const since = t - beat.current.at;
        let e = elev;
        let driftAmp = 0.3;
        let driftSpeed = 0.13;
        if (phase === 'roles') d *= 1 - Math.min(0.1, since * 0.012);
        else if (phase === 'discussion') {
          driftAmp = portrait ? 0.5 : 0.9;
          driftSpeed = 0.1;
        } else if (phase === 'voting') {
          e = elev * 0.72;
          d *= 0.94;
          driftAmp = 0.45;
          driftSpeed = 0.09;
        }
        const drift = still ? 0 : Math.sin(t * driftSpeed) * driftAmp;
        want.set(wantLook.x * 0.55 + drift, wantLook.y + Math.sin(e) * d, wantLook.z + Math.cos(e) * d);
        if (phase === 'reveal' && !still && since < 0.6) {
          const s = (1 - since / 0.6) * 0.09;
          want.x += Math.sin(t * 71) * s;
          want.y += Math.cos(t * 83) * s;
        }
      }
    }
    const k = first.current ? 1 : 1 - Math.exp(-(still ? 8 : 2.2) * dt);
    first.current = false;
    cam.position.lerp(want, k);
    look.current.lerp(wantLook, k);
    cam.lookAt(look.current);
    // The shake has to bypass the smoothing or it disappears.
    if (variant === 'game' && phase === 'reveal' && !still) {
      const since = t - beat.current.at;
      if (since < 0.6) {
        const s = (1 - since / 0.6) * 0.035;
        cam.position.x += Math.sin(t * 71) * s;
        cam.position.y += Math.cos(t * 83) * s;
      }
    }
  });
  return null;
}

type Anchors = React.RefObject<Record<string, HTMLDivElement | null>>;

/** Pins each seat's HTML label (which lives in the normal DOM) above its character's head. */
function LabelProjector({ seats, layout, anchors }: { seats: Seat[]; layout: Layout; anchors: Anchors }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    seats.forEach((seat, i) => {
      const el = anchors.current[seat.id];
      const spot = layout.spots[i];
      if (!el || !spot) return;
      v.set(spot.x, TABLE_Y - 0.2 + headHeight(seat.look) + 0.46, spot.z).project(camera);
      // Keep labels on screen: never past the side edges, never up under the top HUD.
      const pad = Math.min(84, size.width * 0.2);
      const x = Math.min(size.width - pad, Math.max(pad, (v.x * 0.5 + 0.5) * size.width));
      // On a phone the leave button sits top-left, so labels near it stay below it.
      const phone = size.width < 560;
      const y = Math.max(phone ? (x < 132 ? 134 : 86) : 118, (-v.y * 0.5 + 0.5) * size.height);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden';
    });
  });
  return null;
}

function World({ seats, focusId, tone = 'neutral', variant = 'game', low, still, anchors, phase }: SceneProps & { anchors?: Anchors }) {
  const layout = useMemo(() => layoutFor(variant === 'solo' ? 1 : seats.length, variant === 'home' ? 170 : 250), [seats.length, variant]);
  const focusIndex = focusId ? seats.findIndex((s) => s.id === focusId) : -1;
  const focusSpot = focusIndex >= 0 ? layout.spots[focusIndex] : null;
  const focus = useMemo(() => (focusSpot ? new THREE.Vector3(focusSpot.x, 1.7, focusSpot.z) : null), [focusSpot?.x, focusSpot?.z]); // eslint-disable-line react-hooks/exhaustive-deps
  const bg = variant === 'solo' ? '#1a1538' : '#110e1e';
  const blob = useMemo(glowTexture, []);
  useEffect(() => () => blob.dispose(), [blob]);

  return (
    <>
      <color attach="background" args={[bg]} />
      {variant !== 'solo' && <fog attach="fog" args={[bg, 10, 26]} />}
      <Reflections intensity={variant === 'solo' ? 0.32 : 0.26} />
      <ambientLight intensity={0.18} color="#a9a0e0" />
      <hemisphereLight args={['#d6d0ff', '#241a3a', 0.28]} />
      <directionalLight position={[1.5, 4, 7]} intensity={0.75} color="#fff1e4" />
      <directionalLight position={[-5, 3, -4]} intensity={0.9} color="#8f7dff" />
      {/* a warm rim from the opposite side, so silhouettes separate from the dark wall */}
      <directionalLight position={[6, 2.5, -5]} intensity={0.55} color="#ff8a5c" />
      <Rig layout={layout} focus={focus} variant={variant} still={still} phase={phase} />

      {variant === 'solo' ? (
        <>
          <spotLight position={[1.5, 4.5, 3.5]} angle={0.5} penumbra={1} intensity={42} color="#fff3e0" castShadow={!low} shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-radius={6} />
          {/* backdrop disc + plinth */}
          <mesh position={[0, 1.25, -1.6]}>
            <circleGeometry args={[1.45, 64]} />
            <meshBasicMaterial color="#2c2560" />
          </mesh>
          <mesh position={[0, 0.2, 0]} receiveShadow>
            <cylinderGeometry args={[0.95, 1.0, 0.4, 64]} />
            <meshPhysicalMaterial color="#251d45" roughness={0.25} clearcoat={1} clearcoatRoughness={0.1} />
          </mesh>
          <mesh position={[0, 0.405, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.84, 0.88, 96]} />
            <meshBasicMaterial color="#ff6b3d" />
          </mesh>
          {seats[0] && (
            <group position={[0, 0.4, 0]}>
              <Character {...seats[0]} still={still} shadows={!low} />
            </group>
          )}
        </>
      ) : (
        <>
          <Room low={low} rugR={layout.seatR + 1.5} />
          <Halo tone={tone} focus={focus} low={low} height={4.2} tableR={layout.tableR} />
          <Table radius={layout.tableR} activeSpot={focusSpot} tone={tone} />
          {!low && <Dust still={still} />}
          {anchors && <LabelProjector seats={seats} layout={layout} anchors={anchors} />}
          {seats.map((seat, i) => {
            const spot = layout.spots[i];
            if (!spot) return null;
            // Everyone else turns their head toward whoever has the floor.
            let attendYaw: number | undefined;
            if (focusSpot && i !== focusIndex) {
              const world = Math.atan2(focusSpot.x - spot.x, focusSpot.z - spot.z);
              attendYaw = Math.atan2(Math.sin(world - spot.rot), Math.cos(world - spot.rot));
            }
            return (
              <group
                key={seat.id}
                position={[spot.x, 0, spot.z]}
                rotation={[0, spot.rot, 0]}
                // Voting happens here: click or tap the character you suspect.
                onClick={seat.pickable ? (e) => { e.stopPropagation(); seat.onPick?.(); } : undefined}
                onPointerOver={seat.pickable ? (e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; } : undefined}
                onPointerOut={seat.pickable ? () => { document.body.style.cursor = ''; } : undefined}
              >
                <PickRing pickable={!!seat.pickable} picked={!!seat.picked} />
                <Chair shadow={blob} />
                <group position={[0, TABLE_Y - 0.2, 0]}>
                  <Character {...seat} attendYaw={attendYaw} still={still} shadows={!low} />
                </group>
              </group>
            );
          })}
        </>
      )}
    </>
  );
}

export function TableScene(props: SceneProps) {
  const anchors = useRef<Record<string, HTMLDivElement | null>>({});
  const labelled = props.variant !== 'solo' && props.seats.some((s) => s.label);
  return (
    <>
      <Canvas
        className="scene-canvas"
        shadows={!props.low}
        dpr={props.low ? [1, 1.25] : [1, 2]}
        gl={{ antialias: !props.low, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.NeutralToneMapping }}
        camera={{ fov: 34, near: 0.1, far: 60, position: [0, 3.4, 8.5] }}
      >
        <World {...props} anchors={labelled ? anchors : undefined} />
      </Canvas>
      {labelled && (
        <div className="labels">
          {props.seats.map((s) => (
            // The label is a second, larger target for the same action as clicking the character.
            <div
              key={s.id}
              className={`label-anchor ${s.pickable ? 'pickable' : ''} ${s.picked ? 'picked' : ''}`}
              ref={(el) => void (anchors.current[s.id] = el)}
              onClick={s.pickable ? s.onPick : undefined}
              role={s.pickable ? 'button' : undefined}
              tabIndex={s.pickable ? 0 : undefined}
              onKeyDown={s.pickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.onPick?.(); } } : undefined}
            >
              {s.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
