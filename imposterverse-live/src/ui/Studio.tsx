// Character studio: your chosen body with your live face on it, plus the wardrobe controls.
import { useMemo } from 'react';
import { TableScene } from '../three/TableScene';
import { ACCESSORIES, BODIES, PALETTES, bodyOf } from '../three/looks';
import type { FaceSource } from '../three/FaceMaterial';
import { isLowGraphics, levelOf, usePrefs, useProfile } from '../state/app';
import { face, media, useMedia } from '../media/local';
import { Button, Icon, IconButton, Toggle } from './kit';
import { sfx } from '../audio/sfx';

/** The local player's live face as a texture source, or null when the camera is off. */
export function useLocalFace(): FaceSource | null {
  const camOn = useMedia((s) => s.camOn);
  return useMemo(() => (camOn ? { kind: 'canvas' as const, canvas: face.canvas, live: () => face.hasFace } : null), [camOn]);
}

const STATUS: Record<string, string> = {
  off: 'Camera off',
  requesting: 'Waiting for permission',
  loading: 'Loading face tracking',
  searching: 'Looking for your face',
  live: 'Live',
  error: 'Camera unavailable',
};

export function Studio({ height }: { height?: number | string }) {
  const look = useProfile((s) => s.look);
  const update = useProfile((s) => s.update);
  const xp = useProfile((s) => s.xp);
  const prefs = usePrefs();
  const camOn = useMedia((s) => s.camOn);
  const status = useMedia((s) => s.camStatus);
  const localFace = useLocalFace();
  const { level } = levelOf(xp);
  const body = bodyOf(look);
  const index = BODIES.findIndex((b) => b.id === body.id);

  const cycle = (dir: number) => {
    sfx.tap();
    for (let i = 1; i <= BODIES.length; i++) {
      const next = BODIES[(index + dir * i + BODIES.length * 4) % BODIES.length];
      if (next.level <= level) return update({ look: { ...look, body: next.id } });
    }
  };

  const seats = useMemo(() => [{ id: 'me', look, seed: 0.3, face: localFace, mirror: prefs.mirrorSelf }], [look, localFace, prefs.mirrorSelf]);

  return (
    <div className="studio" style={{ height }}>
      <TableScene seats={seats} variant="solo" low={isLowGraphics(prefs)} still={prefs.reducedMotion} />
      <div className="overlay">
        {camOn ? (
          <span className={`pill ${status === 'live' ? 'live' : 'gold'}`}>
            {status === 'live' && <i />}
            {STATUS[status]}
          </span>
        ) : (
          <span className="pill">Camera off</span>
        )}
        <span className="pill gold">{body.vibe}</span>
      </div>
      <div className="arrows">
        <IconButton icon="back" label="Previous character" onClick={() => cycle(-1)} />
        <IconButton icon="next" label="Next character" onClick={() => cycle(1)} />
      </div>
      <div className="caption">
        <div>
          <div className="display">{body.name}</div>
          <div className="small muted">{body.blurb}</div>
        </div>
      </div>
    </div>
  );
}

export function Wardrobe() {
  const look = useProfile((s) => s.look);
  const update = useProfile((s) => s.update);
  const xp = useProfile((s) => s.xp);
  const { level } = levelOf(xp);
  const set = (patch: Partial<typeof look>) => update({ look: { ...look, ...patch } });

  return (
    <div className="col gap-l">
      <div className="field">
        <span className="label">Character</span>
        <div className="chips">
          {BODIES.map((b) => (
            <button key={b.id} type="button" className={`chip ${look.body === b.id ? 'on' : ''}`} disabled={b.level > level} onClick={() => { sfx.tap(); set({ body: b.id }); }} title={b.level > level ? `Unlocks at level ${b.level}` : b.blurb}>
              {b.name.replace('The ', '')}
              {b.level > level && <span className="lock">LV {b.level}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Colourway</span>
        <div className="swatches">
          {PALETTES.map((p, i) => (
            <button key={p.name} type="button" className={`swatch ${look.palette === i ? 'on' : ''}`} disabled={p.level > level} aria-label={`${p.name}${p.level > level ? ` (level ${p.level})` : ''}`} title={p.level > level ? `${p.name} — unlocks at level ${p.level}` : p.name} style={{ backgroundImage: `linear-gradient(135deg, ${p.primary} 50%, ${p.accent} 50%)` }} onClick={() => { sfx.tap(); set({ palette: i }); }} />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label">Accessory</span>
        <div className="chips">
          {ACCESSORIES.map((a) => (
            <button key={a.id} type="button" className={`chip ${look.accessory === a.id ? 'on' : ''}`} disabled={a.level > level} onClick={() => { sfx.tap(); set({ accessory: a.id }); }}>
              {a.name}
              {a.level > level && <span className="lock">LV {a.level}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Camera + microphone consent and controls. Nothing starts until the player asks for it. */
export function MediaSetup() {
  const m = useMedia();
  const look = useProfile((s) => s.look);
  const update = useProfile((s) => s.update);
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;

  return (
    <div className="card col">
      <div className="row between">
        <div className="row gap-s">
          <Icon name={m.camOn ? 'cam' : 'camOff'} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ivory)' }}>Live face</div>
            <div className="tiny muted">{m.camOn ? STATUS[m.camStatus] : 'Your real face becomes your character’s head.'}</div>
          </div>
        </div>
        <Button size="sm" variant={m.camOn ? 'ghost' : 'primary'} onClick={() => (m.camOn ? media.disableCamera() : media.enableCamera())}>
          {m.camOn ? 'Turn off' : 'Enable camera'}
        </Button>
      </div>
      {m.camError && <div className="small" style={{ color: 'var(--rose)' }}>{m.camError}</div>}
      {insecure && <div className="small" style={{ color: 'var(--rose)' }}>Camera and microphone need a secure (https) address. You can still play with the mask character.</div>}
      {m.camOn && m.cameras.length > 1 && (
        <select className="input" aria-label="Camera" value={m.cameraId ?? ''} onChange={(e) => media.selectCamera(e.target.value)}>
          {m.cameras.map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>
          ))}
        </select>
      )}
      {m.camOn && (
        <div className="row between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>Studio light</div>
            <div className="tiny muted">A soft brightness lift. Your face is never altered or replaced.</div>
          </div>
          <Toggle on={look.enhance} onChange={(v) => update({ look: { ...look, enhance: v } })} label="Studio light" />
        </div>
      )}
      <hr className="rule" />
      <div className="row between">
        <div className="row gap-s">
          <Icon name={m.micOn ? 'mic' : 'micOff'} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ivory)' }}>Voice</div>
            <div className="tiny muted">{m.micOn ? 'Microphone on' : 'Optional. Talk to the table.'}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => (m.micOn ? media.disableMic() : media.enableMic())}>
          {m.micOn ? 'Mute' : 'Enable mic'}
        </Button>
      </div>
      {m.micError && <div className="small" style={{ color: 'var(--rose)' }}>{m.micError}</div>}
      <div className="tiny faint">
        Face tracking and background removal run on this device. Only your head cutout is streamed, only to players in your room, and nothing is recorded or stored.
      </div>
    </div>
  );
}
