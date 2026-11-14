// Shared UI pieces: logo, icons, buttons, form controls.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNav, type Screen } from '../state/app';
import { sfx } from '../audio/sfx';

// ---- brand ---------------------------------------------------------------

/** The mark: a face, half in the open and half behind a mask. */
export function Mark({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      {/* A rounded face split down the middle: one half in the open, one half winking behind a mask. */}
      <rect x="6" y="5" width="52" height="54" rx="24" fill="#f6f2ea" />
      <path d="M32 5h2a24 24 0 0 1 24 24v6a24 24 0 0 1-24 24h-2z" fill="#ff6b3d" />
      <ellipse cx="21.5" cy="29" rx="5" ry="6.5" fill="#16111f" />
      <path d="M38 30.5c2.2-3 6.8-3 9 0" stroke="#16111f" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M24 44c4 3.6 12 3.6 16 0" stroke="#16111f" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={32} />
      <span className="name">imposterverse</span>
      <span className="live">
        <i />
        LIVE
      </span>
    </span>
  );
}

// ---- icons ---------------------------------------------------------------

const PATHS: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cam: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 10.5l6-3v9l-6-3" /></>,
  camOff: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 10.5l6-3v9l-6-3M3 3l18 18" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" /></>,
  micOff: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M3 3l18 18" /></>,
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5v.5M15 9.5v.5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8" /></>,
  crown: <path d="M4 18h16M4.5 15l-1-8 5 4L12 5l3.5 6 5-4-1 8z" />,
  exit: <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  wifiOff: <path d="M3 3l18 18M5 12.5a10 10 0 013-2M19 12.5a10 10 0 00-6-3M8.5 16a5 5 0 017 0M12 19.5v.01" />,
  volOff: <path d="M4 9v6h4l5 4V5L8 9H4zM17 9l4 6M21 9l-4 6" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  star: <path d="M12 4l2.4 5 5.6.7-4.1 3.8 1 5.5-4.9-2.7L7.1 19l1-5.5L4 9.7 9.6 9z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  flag: <path d="M6 21V4h11l-2 4 2 4H6" />,
  block: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>,
  users: <><circle cx="9" cy="9" r="3.5" /><path d="M2.5 19c.9-3.300 3.400-5 6.500-5s5.600 1.700 6.500 5M16 5.800a3.500 3.500 0 010 6.400M18 14.600c1.700.700 2.900 2.200 3.500 4.400" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.300 9.500a2.800 2.800 0 115 1.700c-.900 1-2.300 1.400-2.300 3M12 17.500v.01" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.2-4 4.3-6 8-6s6.8 2 8 6" /></>,
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// ---- controls ------------------------------------------------------------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm'; wide?: boolean; quiet?: boolean };

export function Button({ variant, size, wide, quiet, className = '', onClick, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn ${variant ?? ''} ${size ?? ''} ${wide ? 'wide' : ''} ${className}`}
      onClick={(e) => {
        if (!quiet) sfx.tap();
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({ icon, label, on, off, badge, onClick, className = '' }: { icon: string; label: string; on?: boolean; off?: boolean; badge?: number; onClick?: () => void; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${on ? 'on' : ''} ${off ? 'off' : ''} ${className}`} aria-label={label} title={label} aria-pressed={on} onClick={() => { sfx.tap(); onClick?.(); }}>
      <Icon name={icon} />
      {!!badge && <span className="badge">{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => { sfx.tap(); onChange(!on); }} />;
}

export function Stepper({ value, min, max, step = 1, onChange, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <span className="stepper">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => { sfx.tap(); onChange(Math.max(min, value - step)); }}>−</button>
      <span>{format ? format(value) : value}</span>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => { sfx.tap(); onChange(Math.min(max, value + step)); }}>+</button>
    </span>
  );
}

export function Setting({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="grow">
        <div className="t">{title}</div>
        {hint && <div className="d">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Page({ title, back = 'home', onBack, children, wide, actions }: { title: string; back?: Screen; onBack?: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  const go = useNav((s) => s.go);
  return (
    <div className="screen page">
      <header className="page-head">
        <IconButton icon="back" label="Back" onClick={() => (onBack ? onBack() : go(back))} />
        <h2 className="display grow">{title}</h2>
        {actions}
      </header>
      <div className="page-body">
        <div className={`inner ${wide ? 'wide' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="row between">
          <h3 className="display" style={{ fontSize: 16 }}>{title}</h3>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A face-down card that only shows its contents while it is physically held.
 * Releasing, leaving the card, switching tabs or losing focus hides it again.
 */
export function HoldCard({ children, back, tone, big, onRevealed }: { children: ReactNode; back?: ReactNode; tone?: 'imposter' | 'crew'; big?: boolean; onRevealed?: () => void }) {
  const [show, setShow] = useState(false);
  const told = useRef(false);
  useEffect(() => {
    const hide = () => setShow(false);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  const reveal = () => {
    setShow(true);
    if (!told.current) {
      told.current = true;
      onRevealed?.();
    }
  };
  return (
    <div
      className={`role-card ${big ? 'big' : ''} ${show ? 'show' : ''} ${show && tone === 'imposter' ? 'imposter' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Hold to reveal your secret role"
      onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); reveal(); }}
      onPointerUp={() => setShow(false)}
      onPointerCancel={() => setShow(false)}
      onLostPointerCapture={() => setShow(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); } }}
      onKeyUp={() => setShow(false)}
      onBlur={() => setShow(false)}
    >
      <div className="back">
        {back ?? (
          <>
            <Mark size={54} />
            <div className="eyebrow">Hold to reveal your secret</div>
            <div className="tiny faint">Release to hide</div>
          </>
        )}
      </div>
      <div className="front" aria-hidden={!show}>{show ? children : null}</div>
    </div>
  );
}

/** Re-renders on an interval; used for countdowns. */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function TimerRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, seconds / total)) : 0;
  return (
    <div className={`timer ${seconds <= 5 ? 'urgent' : ''}`} role="timer" aria-label={`${seconds} seconds left`}>
      <svg viewBox="0 0 54 54">
        <circle cx="27" cy="27" r={r} />
        <circle className="arc" cx="27" cy="27" r={r} strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span style={{ position: 'relative' }}>{seconds}</span>
    </div>
  );
}

export function Confetti({ count = 46 }: { count?: number }) {
  const bits = useRef(
    Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      dur: 2.2 + Math.random() * 2,
      rot: Math.random() * 360,
      tone: i % 3,
    })),
  ).current;
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s`, transform: `rotate(${b.rot}deg)`, background: b.tone === 0 ? '#ffd04f' : b.tone === 1 ? '#5fe0ab' : '#ff6b3d' }} />
      ))}
    </div>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
