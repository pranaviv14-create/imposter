import { useEffect, useMemo, useState } from 'react';
import { isLowGraphics, useNav, usePrefs, useProfile, type Screen } from '../state/app';
import { net, useNet } from '../net/client';
import { TableScene, type Seat } from '../three/TableScene';
import { Button, Icon, Mark, Wordmark } from '../ui/kit';
import { sfx } from '../audio/sfx';

export function Splash() {
  const go = useNav((s) => s.go);
  useEffect(() => {
    const hasInvite = new URLSearchParams(location.search).has('room');
    const id = setTimeout(() => {
      if (useNet.getState().session) net.resume(); // a reload mid-game drops you straight back at the table
      else go(hasInvite ? 'online' : 'home');
    }, usePrefs.getState().reducedMotion ? 500 : 1900);
    return () => clearTimeout(id);
  }, [go]);
  return (
    <div className="screen splash">
      <div className="stack">
        <Mark size={104} className="mark" />
        <h1 className="display">imposterverse</h1>
        <span className="live-sticker tag"><i />LIVE</span>
        <div className="bar"><i /></div>
      </div>
    </div>
  );
}

const MENU: { screen: Screen; title: string; icon: string }[] = [
  { screen: 'modes', title: 'Modes', icon: 'grid' },
  { screen: 'friends', title: 'Friends', icon: 'users' },
  { screen: 'profile', title: 'Profile', icon: 'user' },
  { screen: 'settings', title: 'Settings', icon: 'gear' },
  { screen: 'howto', title: 'How to play', icon: 'help' },
];

export function Home() {
  const go = useNav((s) => s.go);
  const openLegal = useNav((s) => s.openLegal);
  const prefs = usePrefs();
  const myLook = useProfile((s) => s.look);

  // The table never sits still: every few seconds somebody new takes the floor and somebody reacts.
  const [scene, setScene] = useState({ speaker: 1, reactor: 3, react: 'think', at: 0 });
  useEffect(() => {
    if (prefs.reducedMotion) return;
    const emotes = ['laugh', 'gasp', 'think', 'sus', 'clap', 'heart'];
    const id = setInterval(() => {
      setScene((s) => {
        const speaker = (s.speaker + 1 + Math.floor(Math.random() * 3)) % 5;
        let reactor = Math.floor(Math.random() * 5);
        if (reactor === speaker) reactor = (reactor + 2) % 5;
        return { speaker, reactor, react: emotes[Math.floor(Math.random() * emotes.length)], at: Date.now() };
      });
    }, 3600);
    return () => clearInterval(id);
  }, [prefs.reducedMotion]);

  // A table of masked strangers, waiting for you.
  const seats = useMemo<Seat[]>(() => {
    const cast: Seat[] = [
      { id: 'a', look: { body: 'sleuth', palette: 3, accessory: 'none', enhance: false }, seed: 0.11, face: null },
      { id: 'b', look: { body: 'jester', palette: 1, accessory: 'none', enhance: false }, seed: 0.42, face: null },
      { id: 'c', look: myLook, seed: 0.77, face: null },
      { id: 'd', look: { body: 'captain', palette: 4, accessory: 'none', enhance: false }, seed: 0.63, face: null },
      { id: 'e', look: { body: 'nightowl', palette: 2, accessory: 'scarf', enhance: false }, seed: 0.9, face: null },
    ];
    return cast.map((seat, i) => ({
      ...seat,
      speaking: i === scene.speaker,
      active: i === scene.speaker,
      reactAt: i === scene.reactor && scene.at ? scene.at : undefined,
      react: i === scene.reactor ? scene.react : undefined,
    }));
  }, [myLook, scene]);
  const speakerId = seats[scene.speaker]?.id ?? 'c';

  return (
    <div className="screen home">
      <TableScene seats={seats} variant="home" focusId={speakerId} low={isLowGraphics(prefs)} still={prefs.reducedMotion} />
      <div className="shade" />
      <div className="content">
        <Wordmark />
        <div className="hero">
          <h1 className="display">Imposterverse</h1>
          <p className="tag">
            <b>Your face. Your character. Your secret.</b>
            <br />
            One word, one liar, and everyone is watching.
          </p>
          <div className="home-actions">
            <Button variant="primary" onClick={() => go('online')}>
              Play online
              <small>Private rooms, live faces</small>
            </Button>
            <Button onClick={() => go('offline')}>
              Play offline
              <small>Pass one phone around</small>
            </Button>
          </div>
          <nav className="menu" aria-label="More">
            {MENU.map((m) => (
              <button key={m.screen} type="button" onClick={() => { sfx.tap(); go(m.screen); }}>
                <Icon name={m.icon} size={22} />
                {m.title}
              </button>
            ))}
          </nav>
        </div>
        <div className="foot">
          <span className="tiny faint">v1.1 · Someone at this table is lying.</span>
          <span className="row gap-s">
            <button type="button" className="link" onClick={() => openLegal('privacy')}>Privacy</button>
            <button type="button" className="link" onClick={() => openLegal('terms')}>Terms</button>
          </span>
        </div>
      </div>
    </div>
  );
}
