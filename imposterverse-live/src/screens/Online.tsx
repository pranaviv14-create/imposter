// Play Online: choose a name and character, opt in to camera/mic, then create or join a private room.
import { useState } from 'react';
import { LIMITS } from '../../shared/types';
import { useNav, useProfile } from '../state/app';
import { media } from '../media/local';
import { net, useNet } from '../net/client';
import { Button, Page } from '../ui/kit';
import { MediaSetup, Studio, Wardrobe } from '../ui/Studio';

export function Online() {
  const invite = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) ?? '';
  const name = useProfile((s) => s.name);
  const update = useProfile((s) => s.update);
  const busy = useNet((s) => s.busy);
  const go = useNav((s) => s.go);
  const [tab, setTab] = useState<'create' | 'join'>(invite ? 'join' : 'create');
  const [code, setCode] = useState(invite);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2;

  return (
    <Page title="Play online" wide onBack={() => { media.stopAll(); go('home'); }}>
      <div className="online-grid">
        <Studio />
        <div className="col gap-l">
          <div className="field">
            <label htmlFor="name">Your name at the table</label>
            <input id="name" className="input" value={name} maxLength={LIMITS.nameLength} placeholder="Enter a name" autoComplete="nickname" onChange={(e) => update({ name: e.target.value })} />
          </div>

          <MediaSetup />
          <Wardrobe />

          <div className="panel" style={{ boxShadow: 'none' }}>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>Create room</button>
              <button type="button" role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'on' : ''} onClick={() => setTab('join')}>Join room</button>
            </div>
            <div className="col" style={{ padding: 18 }}>
              {tab === 'create' ? (
                <>
                  <p className="small muted">Open a private table. You will get a room code and an invite link to share. Rules can be set in the lobby.</p>
                  <Button variant="primary" wide disabled={!ready || busy} onClick={() => net.createRoom()}>
                    {busy ? 'Opening…' : 'Create private room'}
                  </Button>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="code">Room code</label>
                    <input id="code" className="input code" value={code} maxLength={5} placeholder="•••••" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && ready && code.length === 5 && net.joinRoom(code)} />
                  </div>
                  <Button variant="primary" wide disabled={!ready || code.length !== 5 || busy} onClick={() => net.joinRoom(code)}>
                    {busy ? 'Joining…' : 'Join room'}
                  </Button>
                </>
              )}
              {!ready && <p className="tiny faint center">Enter a name of at least two characters to continue.</p>}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
