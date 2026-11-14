// Menu pages: game modes, friends, profile, settings, how to play, legal.
import { useEffect, useState } from 'react';
import { MODES } from '../../shared/engine';
import { LIMITS } from '../../shared/types';
import { CATEGORIES, TOTAL_WORDS } from '../../shared/words';
import { ACHIEVEMENTS, levelOf, useNav, usePrefs, useProfile, type Friend } from '../state/app';
import { face, media, useMedia } from '../media/local';
import { serverBase, showNotice, useNet } from '../net/client';
import { Button, Icon, IconButton, Page, Setting, Toggle, copyText } from '../ui/kit';
import { MediaSetup, Studio, Wardrobe } from '../ui/Studio';
import { sfx } from '../audio/sfx';

// ---- game modes ----------------------------------------------------------

export function Modes() {
  const go = useNav((s) => s.go);
  return (
    <Page title="Game modes" wide>
      <p className="muted">Classic Imposter is the signature game. The engine is built so new modes slot in without touching the core — these are next.</p>
      <div className="grid-2">
        {Object.values(MODES).map((m) => (
          <div key={m.id} className={`mode-card ${m.status}`}>
            <span className="glyph" aria-hidden="true">{m.name.slice(0, 1)}</span>
            <div className="row between">
              <span className={`pill ${m.status === 'live' ? 'gold' : ''}`}>{m.status === 'live' ? 'Playable now' : 'In development'}</span>
              <span className="tiny faint">{m.minPlayers}+ players</span>
            </div>
            <h3>{m.name}</h3>
            <div className="small gold">{m.tagline}</div>
            <p className="small muted grow">{m.description}</p>
            {m.status === 'live' && (
              <div className="row gap-s wrap">
                <Button variant="primary" size="sm" onClick={() => go('online')}>Play online</Button>
                <Button variant="ghost" size="sm" onClick={() => go('offline')}>Pass the phone</Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="card">
        <div className="section-title" style={{ marginBottom: 12 }}>Word library</div>
        <p className="small muted" style={{ marginBottom: 12 }}>{TOTAL_WORDS} secret words across {CATEGORIES.length} categories. Words do not repeat until a category runs out.</p>
        <div className="chips">
          {CATEGORIES.map((c) => <span key={c.id} className="pill">{c.name} · {c.words.length}</span>)}
        </div>
      </div>
    </Page>
  );
}

// ---- friends -------------------------------------------------------------

function useOnline(ids: string[]) {
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      fetch(`${serverBase()}/api/presence?ids=${encodeURIComponent(key)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => alive && setOnline(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key]);
  return online;
}

export function Friends() {
  const p = useProfile();
  const session = useNet((s) => s.session);
  const [code, setCode] = useState('');
  const [nick, setNick] = useState('');
  const online = useOnline(p.friends.map((f) => f.id));

  const invite = async () => {
    const text = session ? `${location.origin}/?room=${session.code}` : `Add me on IMPOSTERVERSE LIVE — my player ID is ${p.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'IMPOSTERVERSE LIVE', text });
        return;
      } catch {
        /* cancelled */
      }
    }
    showNotice((await copyText(text)) ? (session ? 'Room link copied.' : 'Your player ID was copied.') : text);
  };
  const add = () => {
    const id = code.trim().toUpperCase();
    if (!/^IV[A-Z0-9]{9}$/.test(id)) return showNotice('That does not look like a player ID.');
    if (id === p.id) return showNotice('That is your own ID.');
    p.addFriend({ id, name: nick.trim() || `Player ${id.slice(-4)}` });
    setCode('');
    setNick('');
  };
  const row = (f: Friend, isFriend: boolean) => (
    <div key={f.id} className="roster-item">
      <span className="avatar">{f.name.slice(0, 1).toUpperCase()}</span>
      <span className="grow">
        <span className="nm row gap-s">{f.name}{isFriend && <span className={`dot ${online[f.id] ? 'on' : ''}`} title={online[f.id] ? 'Online' : 'Offline'} />}</span>
        <span className="meta mono">{f.id}{isFriend ? (online[f.id] ? ' · online now' : '') : ''}</span>
      </span>
      {isFriend ? (
        <IconButton icon="trash" label={`Remove ${f.name}`} onClick={() => p.removeFriend(f.id)} />
      ) : (
        <>
          <Button size="sm" variant="ghost" disabled={p.friends.some((x) => x.id === f.id)} onClick={() => p.addFriend(f)}>{p.friends.some((x) => x.id === f.id) ? 'Added' : 'Add'}</Button>
          <IconButton icon="block" label={p.blocked.includes(f.id) ? `Unblock ${f.name}` : `Block ${f.name}`} on={p.blocked.includes(f.id)} onClick={() => p.toggleBlock(f.id)} />
        </>
      )}
    </div>
  );

  return (
    <Page title="Friends">
      <div className="card col">
        <div className="row between wrap">
          <div>
            <div className="label">Your player ID</div>
            <div className="display mono" style={{ fontSize: 26, marginTop: 4 }}>{p.id}</div>
          </div>
          <Button variant="primary" size="sm" onClick={invite}><Icon name="share" size={16} /> {session ? 'Share room link' : 'Invite friends'}</Button>
        </div>
        <p className="tiny faint">Friends are saved on this device. Accounts and cross-device sync arrive with sign-in.</p>
      </div>

      <div className="section-title">Friends · {p.friends.length}</div>
      {p.friends.length ? <div className="roster">{p.friends.map((f) => row(f, true))}</div> : <div className="empty">No friends yet. Add someone you have played with, or enter their player ID below.</div>}

      <div className="card col">
        <div className="label">Add by player ID</div>
        <div className="row gap-s wrap">
          <input className="input grow" style={{ minWidth: 160 }} value={code} placeholder="IVXXXXXXXXX" maxLength={11} autoCapitalize="characters" autoComplete="off" aria-label="Player ID" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <input className="input grow" style={{ minWidth: 120 }} value={nick} placeholder="Nickname" maxLength={LIMITS.nameLength} aria-label="Nickname" onChange={(e) => setNick(e.target.value)} />
          <Button variant="ghost" onClick={add} disabled={!code.trim()}>Add</Button>
        </div>
      </div>

      <div className="section-title">Recently played</div>
      {p.recent.length ? <div className="roster">{p.recent.map((f) => row(f, false))}</div> : <div className="empty">Players you share a table with will appear here.</div>}

      {p.blocked.length > 0 && (
        <>
          <div className="section-title">Blocked · {p.blocked.length}</div>
          <div className="roster">
            {p.blocked.map((id) => (
              <div key={id} className="roster-item">
                <span className="grow meta mono">{[...p.recent, ...p.friends].find((x) => x.id === id)?.name ?? id}</span>
                <Button size="sm" variant="ghost" onClick={() => p.toggleBlock(id)}>Unblock</Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

// ---- profile -------------------------------------------------------------

export function Profile() {
  const p = useProfile();
  const go = useNav((s) => s.go);
  const camLive = useMedia((s) => s.faceLive);
  const { level, progress, toNext } = levelOf(p.xp);
  const s = p.stats;
  const leave = () => {
    media.stopAll();
    go('home');
  };
  return (
    <Page title="Profile" wide onBack={leave}>
      <div className="online-grid">
        <Studio />
        <div className="col gap-l">
          <div className="row">
            <span className="avatar lg">{p.portrait ? <img src={p.portrait} alt="Your portrait" /> : (p.name || 'P').slice(0, 1).toUpperCase()}</span>
            <div className="grow col gap-s">
              <div className="field">
                <label htmlFor="pname">Username</label>
                <input id="pname" className="input" value={p.name} maxLength={LIMITS.nameLength} placeholder="Enter a name" onChange={(e) => p.update({ name: e.target.value })} />
              </div>
              <button type="button" className="link mono" style={{ textAlign: 'left', padding: 0 }} onClick={async () => showNotice((await copyText(p.id)) ? 'Player ID copied.' : p.id)}>ID · {p.id}</button>
            </div>
          </div>
          <div className="row gap-s wrap">
            <Button size="sm" variant="ghost" disabled={!camLive} onClick={() => { const shot = face.snapshot(); if (shot) { p.update({ portrait: shot }); sfx.clue(); } }}>
              <Icon name="cam" size={16} /> {camLive ? 'Use live face as portrait' : 'Enable camera for a portrait'}
            </Button>
            {p.portrait && <Button size="sm" variant="ghost" onClick={() => p.update({ portrait: null })}>Remove portrait</Button>}
          </div>

          <div className="card col gap-s">
            <div className="row between">
              <span className="display" style={{ fontSize: 26 }}>Level {level}</span>
              <span className="small muted mono">{p.xp} XP · {toNext} to next</span>
            </div>
            <div className="xp"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="tiny faint">Levels unlock characters, colourways and accessories. Cosmetics never affect gameplay.</div>
          </div>

          <MediaSetup />
          <Wardrobe />
        </div>
      </div>

      <div className="section-title">Record</div>
      <div className="grid-4">
        <div className="stat"><b>{s.games}</b><span>Games played</span></div>
        <div className="stat"><b>{s.wins}</b><span>Wins</span></div>
        <div className="stat"><b>{s.losses}</b><span>Losses</span></div>
        <div className="stat"><b>{s.escapes}</b><span>Imposter escapes</span></div>
        <div className="stat"><b>{s.catches}</b><span>Correct accusations</span></div>
        <div className="stat"><b>{s.bestStreak}</b><span>Best win streak</span></div>
        <div className="stat"><b>{s.games ? Math.round((s.wins / s.games) * 100) : 0}%</b><span>Win rate</span></div>
        <div className="stat"><b>{p.achievements.length}/{ACHIEVEMENTS.length}</b><span>Honours</span></div>
      </div>

      <div className="section-title">Honours</div>
      <div className="grid-2">
        {ACHIEVEMENTS.map((a) => {
          const got = p.achievements.includes(a.id);
          return (
            <div key={a.id} className={`badge-tile ${got ? 'got' : ''}`}>
              <span className="medal"><Icon name={got ? 'star' : 'lock'} size={16} /></span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--ivory)' }}>{a.name}</div>
                <div className="tiny muted">{a.hint}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="tiny faint">Your profile, stats and portrait are stored on this device only. The portrait is never uploaded.</p>
    </Page>
  );
}

// ---- settings ------------------------------------------------------------

export function Settings() {
  const prefs = usePrefs();
  const openLegal = useNav((s) => s.openLegal);
  return (
    <Page title="Settings">
      <div className="section-title">Sound</div>
      <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <Setting title="Volume" hint={prefs.volume === 0 ? 'Muted' : `${Math.round(prefs.volume * 100)}%`}>
          <div style={{ width: 170 }}>
            <input type="range" min={0} max={1} step={0.05} value={prefs.volume} aria-label="Volume" style={{ ['--v' as any]: `${prefs.volume * 100}%` }} onChange={(e) => prefs.set({ volume: Number(e.target.value) })} onPointerUp={() => sfx.turn()} />
          </div>
        </Setting>
      </div>

      <div className="section-title">Motion and graphics</div>
      <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <Setting title="Reduced motion" hint="Calms camera movement, character animation and transitions.">
          <Toggle on={prefs.reducedMotion} onChange={(v) => prefs.set({ reducedMotion: v })} label="Reduced motion" />
        </Setting>
        <Setting title="Graphics quality" hint="Auto picks a lighter scene on weaker phones.">
          <div className="chips">
            {(['auto', 'high', 'low'] as const).map((q) => (
              <button key={q} type="button" className={`chip ${prefs.quality === q ? 'on' : ''}`} onClick={() => prefs.set({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}</button>
            ))}
          </div>
        </Setting>
      </div>

      <div className="section-title">Camera and data</div>
      <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <Setting title="Low-data mode" hint="Lower frame rate and bitrate for your live face, simpler cutout, lighter scene.">
          <Toggle on={prefs.lowData} onChange={(v) => prefs.set({ lowData: v })} label="Low-data mode" />
        </Setting>
        <Setting title="Face cutout" hint="Full removes the background around your head and hair. Lite cuts a face-shaped oval and is easier on older phones.">
          <div className="chips">
            <button type="button" className={`chip ${prefs.maskMode === 'segment' ? 'on' : ''}`} onClick={() => prefs.set({ maskMode: 'segment' })}>Full</button>
            <button type="button" className={`chip ${prefs.maskMode === 'lite' ? 'on' : ''}`} onClick={() => prefs.set({ maskMode: 'lite' })}>Lite</button>
          </div>
        </Setting>
        <Setting title="Mirror my own face" hint="Only changes how you see yourself. Others always see you un-mirrored.">
          <Toggle on={prefs.mirrorSelf} onChange={(v) => prefs.set({ mirrorSelf: v })} label="Mirror my own face" />
        </Setting>
      </div>

      <div className="section-title">About</div>
      <div className="row gap-s wrap">
        <Button variant="ghost" size="sm" onClick={() => openLegal('privacy')}>Privacy policy</Button>
        <Button variant="ghost" size="sm" onClick={() => openLegal('terms')}>Terms of service</Button>
      </div>
      <p className="tiny faint">IMPOSTERVERSE LIVE v1.0</p>
    </Page>
  );
}

// ---- how to play ---------------------------------------------------------

export function HowTo() {
  const go = useNav((s) => s.go);
  const steps: [string, string][] = [
    ['Take a seat', 'Create a private room and share the code, or pass one phone around the room. Three to ten players.'],
    ['Become your character', 'Turn on your camera and your real, live face becomes your character’s head — background removed. Prefer not to? You play as a masked character instead.'],
    ['Get your secret', 'Everyone is shown the same secret word. Everyone except the imposter, who only learns the category.'],
    ['Give a clue', 'In turn, each player gives one word or short phrase. Prove you know the word — without making it easy for the imposter to guess.'],
    ['Discuss', 'Whose clue was vague? Who hesitated? Talk, type, react. Watch their faces.'],
    ['Vote', 'Everyone votes in secret for who they think is the imposter. A tie convicts nobody.'],
    ['The reveal', 'If the imposter gets the most votes: Imposter Caught. If not: The Imposter Escaped, and they score a point.'],
  ];
  return (
    <Page title="How to play">
      <p className="muted">One word. One liar. Everyone is watching everyone else.</p>
      <div className="steps-list">
        {steps.map(([t, d], i) => (
          <div key={t} className="step">
            <span className="num">{i + 1}</span>
            <div>
              <h4>{t}</h4>
              <p className="small muted">{d}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="section-title">Scoring</div>
      <div className="prose">
        <ul>
          <li>The imposter scores <b>one point</b> for escaping.</li>
          <li>A caught imposter scores nothing, and normal players score nothing.</li>
          <li>The host can switch on <b>Detective</b> scoring, where normal players also earn a point for a catch.</li>
          <li>Roles are re-dealt every round. Keep playing until the host ends the session.</li>
        </ul>
      </div>
      <div className="row gap-s wrap">
        <Button variant="primary" onClick={() => go('online')}>Play online</Button>
        <Button variant="ghost" onClick={() => go('offline')}>Play offline</Button>
      </div>
    </Page>
  );
}

// ---- legal ---------------------------------------------------------------

export function Legal() {
  const tab = useNav((s) => s.legalTab);
  const openLegal = useNav((s) => s.openLegal);
  return (
    <Page title={tab === 'privacy' ? 'Privacy policy' : 'Terms of service'}>
      <div className="tabs">
        <button type="button" className={tab === 'privacy' ? 'on' : ''} onClick={() => openLegal('privacy')}>Privacy</button>
        <button type="button" className={tab === 'terms' ? 'on' : ''} onClick={() => openLegal('terms')}>Terms</button>
      </div>
      <div className="card small" style={{ borderColor: 'var(--line-2)' }}>
        This is a plain-language template describing how the software behaves. Have it reviewed by a lawyer and add your company details before a public launch.
      </div>
      {tab === 'privacy' ? (
        <div className="prose">
          <h3>Camera and microphone</h3>
          <p>Your camera and microphone are off until you switch them on, and your browser will ask for permission first. A visible indicator shows whenever your camera is live. You can switch either off at any time with one tap, and the game is fully playable without them.</p>
          <h3>How your face is processed</h3>
          <p>Face tracking and background removal run on your own device. The raw camera image never leaves it. Only the resulting head cutout is streamed, directly between players’ devices where the network allows, and only to people in the same room as you.</p>
          <h3>Spoken clues and speech-to-text</h3>
          <p>When you hold the button to speak a clue, the other players hear your real voice directly. Separately, your browser’s built-in speech recognition turns what you said into text for you to check and correct. In most browsers that recognition is done by the browser maker’s online service, which means the audio of that one utterance is sent to them. If you would rather it was not, type your clue instead — the game never requires speech-to-text.</p>
          <h3>No recording</h3>
          <p>The game does not record, store or analyse video or audio. Nothing is kept once a stream ends. The game server relays connection set-up messages only; it does not receive your video or audio.</p>
          <h3>What is stored</h3>
          <ul>
            <li>On your device: your username, player ID, character, settings, statistics, friends list and optional portrait.</li>
            <li>On the server, only while a room is open: the names, characters and scores of players in that room.</li>
            <li>If you report a player: the room code, both player IDs and the reason you chose.</li>
          </ul>
          <h3>Other players</h3>
          <p>People in your room can see your live face and hear your voice while they are switched on. Anyone can capture their own screen, so only share your camera with people you are comfortable with. You can mute, block and report any player.</p>
          <h3>Children</h3>
          <p>The game is not directed at children under 13 and should not be used by them without a parent or guardian.</p>
        </div>
      ) : (
        <div className="prose">
          <h3>Playing fairly</h3>
          <p>Do not harass other players, show offensive or explicit content on camera, share anyone’s image without consent, or attempt to cheat, disrupt or reverse-engineer rooms you are in.</p>
          <h3>Your content</h3>
          <p>You are responsible for what you say, type and show on camera. Do not record or redistribute other players’ faces or voices without their permission.</p>
          <h3>Moderation</h3>
          <p>Hosts can remove players from their rooms. Reported behaviour may lead to restrictions. Private rooms are invitation-only; public matchmaking is not available.</p>
          <h3>Cosmetics</h3>
          <p>Characters, colourways and accessories are cosmetic and never provide a gameplay advantage.</p>
          <h3>Availability</h3>
          <p>The game is provided as is, without warranty. Features may change, and rooms may close without notice.</p>
        </div>
      )}
    </Page>
  );
}
