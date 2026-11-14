import { useEffect } from 'react';
import { useNav, usePrefs } from './state/app';
import { net, useNet } from './net/client';
import { sfx } from './audio/sfx';
import { Splash, Home } from './screens/Home';
import { Online } from './screens/Online';
import { Room } from './screens/Room';
import { Offline } from './screens/Offline';
import { Friends, HowTo, Legal, Modes, Profile, Settings } from './screens/Pages';

export function App() {
  const screen = useNav((s) => s.screen);
  const reduced = usePrefs((s) => s.reducedMotion);
  const error = useNet((s) => s.error);
  const notice = useNet((s) => s.notice);

  // Mobile browsers only allow audio after a gesture.
  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => net.clearError(), 4500);
    return () => clearTimeout(id);
  }, [error]);

  return (
    <div className={`app ${reduced ? 'reduced' : ''}`}>
      {screen === 'splash' && <Splash />}
      {screen === 'home' && <Home />}
      {screen === 'online' && <Online />}
      {screen === 'room' && <Room />}
      {screen === 'offline' && <Offline />}
      {screen === 'modes' && <Modes />}
      {screen === 'friends' && <Friends />}
      {screen === 'profile' && <Profile />}
      {screen === 'settings' && <Settings />}
      {screen === 'howto' && <HowTo />}
      {screen === 'legal' && <Legal />}
      {error && <div className="toast error" role="alert">{error}</div>}
      {!error && notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
