// The online room: lobby, then the full round loop, all around one live 3D table.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { EMOTES, LIMITS, type PrivateState, type PublicPlayer, type PublicState, type Settings } from '../../shared/types';
import { MODES, estimateMinutes } from '../../shared/engine';
import { CATEGORIES, categoryName } from '../../shared/words';
import { isLowGraphics, usePrefs, useProfile } from '../state/app';
import { net, showNotice, useNet } from '../net/client';
import { mesh, useRtc } from '../net/rtc';
import { media, useMedia } from '../media/local';
import { listen, speechSupported, tidyClue, type Listening } from '../media/speech';
import { TableScene, type Seat, type Tone } from '../three/TableScene';
import { seedOf } from '../three/looks';
import { useLocalFace } from '../ui/Studio';
import { Button, Confetti, HoldCard, Icon, IconButton, Mark, Sheet, Stepper, TimerRing, copyText, useTick } from '../ui/kit';
import { sfx } from '../audio/sfx';

const EMOTE_TEXT: Record<string, string> = { laugh: 'Ha!', gasp: 'Gasp!', think: 'Hmm…', sus: 'Sus.', clap: 'Bravo', heart: '♥' };
/** A game is one secret word and one imposter; inside it are the clue rounds, then one discussion and one vote. */
const gameLabel = (pub: PublicState) => `Game ${pub.game} of ${pub.settings.games}`;
/** "Game 1 of 2 · Clue round 2 of 3" */
const roundLabel = (pub: PublicState) => `${gameLabel(pub)} · Clue round ${pub.round} of ${pub.settings.rounds}`;

/** The title card shown on the stage as each phase begins: [kicker, headline]. */
const STINGER: Record<string, [string, string]> = {
  gameover: ['Session complete', 'Final leaderboard'],
  roles: ['Eyes on your own screen', 'Secret roles'],
  clue: ['One word each', 'Clues'],
  discussion: ['Someone is bluffing', 'Talk it out'],
  voting: ['No going back', 'The vote'],
};
const PHASE_NAME: Record<string, string> = { lobby: 'Lobby', roles: 'Secret Roles', clue: 'Clues', discussion: 'Discussion', voting: 'The Vote', reveal: 'The Reveal', gameover: 'Final Results' };

export function Room() {
  const pub = useNet((s) => s.pub);
  const priv = useNet((s) => s.priv);
  const conn = useNet((s) => s.conn);

  if (!pub || !priv) {
    return (
      <div className="screen splash">
        <div className="stack">
          <Mark size={72} />
          <div className="eyebrow">{conn === 'lost' ? 'Reconnecting to your table' : 'Taking your seat'}</div>
          <div className="bar" style={{ opacity: 1 }}><i /></div>
          <button type="button" className="link" onClick={() => { media.stopAll(); net.leaveRoom(); }}>Cancel</button>
        </div>
      </div>
    );
  }
  return <RoomView pub={pub} priv={priv} />;
}

function RoomView({ pub, priv }: { pub: PublicState; priv: PrivateState }) {
  const profile = useProfile();
  const prefs = usePrefs();
  const conn = useNet((s) => s.conn);
  const speaking = useNet((s) => s.speaking);
  const emotes = useNet((s) => s.emotes);
  const unread = useNet((s) => s.unread);
  const chatOpen = useNet((s) => s.chatOpen);
  const peers = useRtc((s) => s.peers);
  const cam = useMedia((s) => s.camOn);
  const mic = useMedia((s) => s.micOn);
  const localFace = useLocalFace();
  const [emoteBar, setEmoteBar] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [earned, setEarned] = useState<{ xp: number; unlocked: string[] } | null>(null);
  const [verdictKey, setVerdictKey] = useState(0);
  const [flash, setFlash] = useState(false);
  /** Push-to-talk is being held during my clue turn. */
  const [talking, setTalking] = useState(false);
  /** The character I have selected to accuse, before confirming. */
  const [pick, setPick] = useState<string | null>(null);
  const gate = useMedia((s) => s.gate);
  useTick(250);

  const meId = profile.id;
  const me = pub.players.find((p) => p.id === meId);
  const isHost = !!me?.isHost;
  const reveal = pub.reveal;
  const nameOf = (id: string) => pub.players.find((p) => p.id === id)?.name ?? reveal?.names[id] ?? 'Player';
  const remaining = pub.phaseEndsAt ? Math.max(0, Math.ceil((pub.phaseEndsAt - net.now()) / 1000)) : null;
  const total = pub.phase === 'clue' ? pub.settings.clueSeconds : pub.phase === 'discussion' ? pub.settings.discussionSeconds : pub.phase === 'voting' ? pub.settings.votingSeconds : pub.phase === 'reveal' ? 20 : 45;
  const myTurn = pub.phase === 'clue' && pub.currentId === meId;
  const iWon = !!reveal && reveal.outcome !== 'void' && priv.role !== 'spectator' && (reveal.imposterIds.includes(meId) ? reveal.escapedIds.includes(meId) : reveal.outcome === 'caught');

  // ---- sound, stats and other reactions to state changes ----
  const prev = useRef({ phase: pub.phase, current: pub.currentId, clues: pub.clues.length, players: pub.players.length, sec: remaining });
  useEffect(() => {
    const p = prev.current;
    if (pub.phase !== p.phase) {
      if (pub.phase === 'roles') { sfx.role(); setEarned(null); }
      if (pub.phase === 'clue') sfx.roundStart();
      if (pub.phase === 'voting') sfx.votingOpen();
      if (pub.phase === 'reveal' && reveal) {
        setVerdictKey((k) => k + 1);
        setFlash(true);
        setTimeout(() => setFlash(false), 4200);
        if (reveal.outcome === 'caught') { sfx.caught(); setTimeout(() => sfx.eliminate(), 250); }
        else if (reveal.outcome === 'escaped') sfx.escaped();
        if (reveal.outcome !== 'void' && priv.role !== 'spectator') {
          setTimeout(() => (iWon ? sfx.victory() : sfx.defeat()), 1300);
          const isImp = reveal.imposterIds.includes(meId);
          const res = profile.recordRound({
            key: `${pub.code}:${pub.game}:${reveal.word}`,
            role: isImp ? 'imposter' : 'crew',
            won: iWon,
            escaped: isImp && reveal.escapedIds.includes(meId),
            votedCorrectly: !isImp && (reveal.votes[meId] ?? []).some((id) => reveal.imposterIds.includes(id)),
            others: pub.players.filter((x) => x.id !== meId).map((x) => ({ id: x.id, name: x.name })),
          });
          if (res) setEarned(res);
        }
      }
    }
    if (pub.phase === 'clue' && pub.currentId !== p.current && pub.currentId === meId) sfx.turn();
    if (pub.clues.length > p.clues) sfx.clue();
    if (pub.players.length > p.players) sfx.join();
    if (pub.players.length < p.players) sfx.leave();
    if (remaining !== null && remaining !== p.sec && remaining <= 5 && remaining > 0 && (myTurn || (pub.phase === 'voting' && !priv.myVotes))) sfx.tick(remaining <= 3);
    prev.current = { phase: pub.phase, current: pub.currentId, clues: pub.clues.length, players: pub.players.length, sec: remaining };
  });

  // ---- who can be heard, by phase ----
  //   clue       push-to-talk: only the player whose turn it is, and only while they hold the button
  //   discussion open microphones for everyone
  //   voting     silence
  // The gate stops this device sending; setAudible stops it playing anyone who should be silent.
  useEffect(() => {
    media.setGate(pub.phase === 'clue' ? myTurn && talking : pub.phase !== 'voting');
    mesh.setAudible(pub.phase === 'clue' ? new Set(pub.currentId ? [pub.currentId] : []) : pub.phase === 'voting' ? new Set() : null);
  }, [pub.phase, pub.currentId, myTurn, talking]);
  useEffect(() => () => { media.setGate(true); mesh.setAudible(null); document.body.style.cursor = ''; }, []);
  // A selection only lives for the vote it was made in.
  useEffect(() => { if (pub.phase !== 'voting') setPick(null); }, [pub.phase]);
  const canPick = pub.phase === 'voting' && priv.role !== 'spectator' && !priv.myVotes;
  useEffect(() => { if (!canPick) document.body.style.cursor = ''; }, [canPick]);

  // Dropping a blocked player's media immediately.
  useEffect(() => {
    mesh.sync(pub.players.filter((p) => p.connected && !profile.blocked.includes(p.id)).map((p) => p.id));
  }, [profile.blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 3D seats ----
  const cluesBy = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of pub.clues) (map[c.playerId] ??= []).push(c.text);
    return map;
  }, [pub.clues]);

  const topScore = Math.max(0, ...pub.players.map((p) => p.score));
  const iWonGame = pub.phase === 'gameover' && topScore > 0 && me?.score === topScore;

  const seats: Seat[] = pub.players.map((p) => {
    const isMe = p.id === meId;
    const blocked = profile.blocked.includes(p.id);
    const peer = peers[p.id];
    const face = isMe ? localFace : p.cam && !blocked && peer ? ({ kind: 'video', el: peer.el } as const) : null;
    const inRound = pub.order.includes(p.id);
    let mood: Seat['mood'] = 'idle';
    if (reveal && reveal.outcome !== 'void' && inRound) {
      const isImp = reveal.imposterIds.includes(p.id);
      const won = isImp ? reveal.escapedIds.includes(p.id) : reveal.outcome === 'caught';
      // Caught or wrongly accused slumps; the winning side celebrates; everyone else takes it badly.
      mood = reveal.accusedIds.includes(p.id) ? 'out' : won ? 'win' : 'lose';
    }
    // On the final leaderboard the game's winners celebrate.
    if (pub.phase === 'gameover' && topScore > 0 && p.score === topScore) mood = 'win';
    const votedFor = priv.myVotes ?? (pick ? [pick] : []);
    return {
      id: p.id,
      look: p.look,
      seed: seedOf(p.id),
      face,
      mirror: isMe && prefs.mirrorSelf,
      speaking: !!speaking[p.id] && p.connected,
      active: pub.currentId === p.id,
      mood,
      dim: !p.connected,
      reactAt: emotes[p.id]?.at,
      react: emotes[p.id]?.emote,
      // Voting: every other player in the round can be clicked.
      pickable: canPick && inRound && !isMe,
      picked: pub.phase === 'voting' && votedFor.includes(p.id),
      onPick: () => { sfx.tap(); setPick(p.id); },
      label: <SeatLabel p={p} isMe={isMe} pub={pub} clues={cluesBy[p.id]} speaking={!!speaking[p.id]} emote={emotes[p.id]} />,
    };
  });

  const tone: Tone = reveal ? (reveal.outcome === 'caught' ? 'caught' : reveal.outcome === 'escaped' ? 'escaped' : 'neutral') : pub.phase === 'voting' ? 'tense' : 'neutral';
  const focusId = pub.phase === 'clue' ? pub.currentId : reveal?.accusedIds[0] ?? null;

  const leave = () => {
    media.stopAll();
    net.leaveRoom();
  };

  return (
    <div className="screen room">
      <div className="stage">
        <TableScene seats={seats} focusId={focusId} tone={tone} phase={pub.phase} low={isLowGraphics(prefs)} still={prefs.reducedMotion} />
        <div className={`vignette ${pub.phase === 'voting' ? 'tense' : ''} ${reveal && reveal.outcome !== 'void' && priv.role !== 'spectator' ? (iWon ? 'won' : 'lost') : ''}`} />

        {/* a title card as each phase begins */}
        {STINGER[pub.phase] && (
          <div key={`${pub.game}-${pub.phase}-${pub.phase === 'clue' ? pub.round : 0}`} className={`stinger ${pub.phase}`} aria-hidden="true">
            {/* a new round announces itself: which round, and who speaks first */}
            <span>{pub.phase === 'roles' ? gameLabel(pub) : pub.phase === 'clue' ? `Clue round ${pub.round} of ${pub.settings.rounds}` : STINGER[pub.phase][0]}</span>
            <b>{pub.phase === 'clue' ? (pub.starterId === meId ? 'You start' : `${nameOf(pub.starterId ?? '')} starts`) : pub.phase === 'roles' ? 'A new secret' : STINGER[pub.phase][1]}</b>
          </div>
        )}

        <div className="hud-top">
          <IconButton icon="exit" label="Leave room" onClick={() => (pub.phase === 'lobby' ? leave() : setConfirmLeave(true))} />
          <div className="row gap-s">
            {cam && <span className="pill live" title="Your camera is on"><i />Cam live</span>}
            {mic && pub.phase !== 'lobby' && (
              <span className={`pill ${gate ? 'ok' : ''}`} title="Whether the table can hear you right now">
                <Icon name={gate ? 'mic' : 'micOff'} size={13} />
                {gate ? (pub.phase === 'clue' ? 'On air' : 'Mic open') : pub.phase === 'voting' ? 'Muted for the vote' : myTurn ? 'Hold to talk' : 'Mic held'}
              </span>
            )}
            {remaining !== null && <TimerRing seconds={remaining} total={total} />}
          </div>
        </div>
        <div className="hud-title">
          <div className="eyebrow">{pub.phase === 'lobby' ? `Room ${pub.code}` : pub.phase === 'gameover' ? 'Session complete' : pub.phase === 'clue' ? roundLabel(pub) : gameLabel(pub)}</div>
          <div className="display">{PHASE_NAME[pub.phase]}</div>
        </div>

        {conn !== 'open' && <div className="banner" role="status">Connection lost — reconnecting…</div>}

        {flash && reveal && reveal.outcome !== 'void' && (
          <div key={verdictKey} className={`stage-verdict ${reveal.outcome}`}>
            <h2 className="display">{reveal.outcome === 'caught' ? 'Imposter Caught!' : 'The Imposter Escaped!'}</h2>
            {priv.role !== 'spectator' && <p className={`you ${iWon ? 'won' : 'lost'}`}>{iWon ? 'You win this one' : reveal.imposterIds.includes(meId) ? 'They saw through you' : 'You were fooled'}</p>}
          </div>
        )}
        {reveal && iWon && !prefs.reducedMotion && <Confetti key={`c${verdictKey}`} />}
        {iWonGame && !prefs.reducedMotion && <Confetti key={`g${pub.game}`} count={70} />}
        {canPick && !pick && <div className="stage-hint" role="status">Tap the character you suspect</div>}

        {emoteBar && (
          <div className="emote-bar">
            {EMOTES.map((e) => (
              <button key={e} type="button" onClick={() => { net.send({ t: 'emote', emote: e }); sfx.emote(); setEmoteBar(false); }}>{EMOTE_TEXT[e]}</button>
            ))}
          </div>
        )}
        <div className="hud-controls">
          <IconButton icon={cam ? 'cam' : 'camOff'} label={cam ? 'Turn camera off' : 'Turn camera on'} on={cam} off={!cam} onClick={() => (cam ? media.disableCamera() : media.enableCamera().then((ok) => !ok && showNotice(useMedia.getState().camError || 'Camera unavailable')))} />
          <IconButton icon={mic ? 'mic' : 'micOff'} label={mic ? 'Mute microphone' : 'Unmute microphone'} on={mic} off={!mic} onClick={() => (mic ? media.disableMic() : media.enableMic().then((ok) => !ok && showNotice(useMedia.getState().micError || 'Microphone unavailable')))} />
          <IconButton icon="smile" label="Reactions" on={emoteBar} onClick={() => setEmoteBar((v) => !v)} />
        </div>
        <div className="hud-right">
          <IconButton icon="chat" label="Chat" badge={unread} onClick={() => net.setChatOpen(true)} />
        </div>
      </div>

      <aside className="side">
        {/* keyed by phase so each stage of the round slides in as its own scene */}
        <div className="side-inner" key={pub.phase}>
        {pub.phase === 'lobby' && <Lobby pub={pub} isHost={isHost} meId={meId} onPlayer={setSheetFor} />}
        {pub.phase !== 'lobby' && priv.role === 'spectator' && pub.phase !== 'reveal' && pub.phase !== 'gameover' && <Spectating pub={pub} priv={priv} nameOf={nameOf} />}
        {pub.phase === 'roles' && priv.role !== 'spectator' && <Roles pub={pub} priv={priv} meId={meId} isHost={isHost} />}
        {pub.phase === 'clue' && priv.role !== 'spectator' && <Clues pub={pub} priv={priv} meId={meId} isHost={isHost} nameOf={nameOf} setTalking={setTalking} />}
        {pub.phase === 'discussion' && priv.role !== 'spectator' && <Discussion pub={pub} priv={priv} isHost={isHost} nameOf={nameOf} />}
        {pub.phase === 'voting' && priv.role !== 'spectator' && <Voting pub={pub} priv={priv} meId={meId} nameOf={nameOf} pick={pick} setPick={setPick} />}
        {pub.phase === 'reveal' && reveal && <Reveal pub={pub} meId={meId} isHost={isHost} nameOf={nameOf} earned={earned} onPlayer={setSheetFor} />}
        {pub.phase === 'gameover' && <GameOver pub={pub} meId={meId} isHost={isHost} onLeave={leave} onPlayer={setSheetFor} />}
        </div>
      </aside>

      {chatOpen && <Chat />}
      {sheetFor && <PlayerSheet id={sheetFor} pub={pub} isHost={isHost} onClose={() => setSheetFor(null)} />}
      {confirmLeave && (
        <Sheet title="Leave the table?" onClose={() => setConfirmLeave(false)}>
          <p className="muted">The round continues without you. If you were the imposter, the round is voided for everyone.</p>
          <Button variant="danger" wide onClick={leave}>Leave room</Button>
          <Button variant="ghost" wide onClick={() => setConfirmLeave(false)}>Stay</Button>
        </Sheet>
      )}
    </div>
  );
}

// ---- floating labels above each character ---------------------------------

function SeatLabel({ p, isMe, pub, clues, speaking, emote }: { p: PublicPlayer; isMe: boolean; pub: PublicState; clues?: string[]; speaking: boolean; emote?: { emote: string; at: number } }) {
  const turn = pub.currentId === p.id;
  const reveal = pub.reveal;
  let tag: { text: string; tone: string } | null = null;
  if (!p.connected) tag = { text: 'Reconnecting', tone: 'bad' };
  else if (pub.phase === 'gameover') tag = null;
  else if (p.waiting) tag = { text: 'Joins next game', tone: '' };
  else if (pub.phase === 'lobby') tag = p.isHost ? { text: 'Host', tone: 'gold' } : p.ready ? { text: 'Ready', tone: 'ok' } : { text: 'Not ready', tone: '' };
  else if (pub.phase === 'roles') tag = pub.rolesSeenIds.includes(p.id) ? { text: 'Ready', tone: 'ok' } : pub.starterId === p.id ? { text: 'Speaks first', tone: 'gold' } : { text: 'Reading', tone: '' };
  else if (pub.phase === 'clue' && turn) tag = { text: speaking ? 'Speaking' : 'Their turn', tone: 'gold' };
  else if (pub.phase === 'voting' && pub.order.includes(p.id)) tag = pub.votedIds.includes(p.id) ? { text: 'Voted', tone: 'ok' } : { text: 'Deciding', tone: '' };
  else if (reveal && reveal.imposterIds.includes(p.id)) tag = { text: reveal.accusedIds.includes(p.id) ? 'Imposter — caught' : 'Imposter', tone: 'bad' };
  else if (reveal && reveal.accusedIds.includes(p.id)) tag = { text: 'Wrongly accused', tone: '' };

  const showClues = pub.phase !== 'lobby' && pub.phase !== 'roles' && pub.phase !== 'gameover' && clues && clues.length > 0;
  const fresh = emote && Date.now() - emote.at < 2400;
  return (
    <div className="seat-label">
      {fresh && <div key={emote!.at} className="seat-emote">{EMOTE_TEXT[emote!.emote]}</div>}
      <div className={`seat-name ${isMe ? 'me' : ''} ${turn ? 'turn' : speaking && p.connected ? 'speaking' : ''} ${p.connected ? '' : 'off'}`}>
        {p.isHost && <Icon name="crown" size={12} />}
        {!p.connected && <Icon name="wifiOff" size={12} />}
        {p.name}{isMe ? ' (you)' : ''}
      </div>
      {showClues && <div className={`seat-clue ${clues!.every((c) => !c) ? 'pass' : ''}`}>{clues!.map((c) => c || 'passed').join(' · ')}</div>}
      {tag && <div className={`seat-tag ${tag.tone}`}>{tag.text}</div>}
    </div>
  );
}

// ---- lobby ----------------------------------------------------------------

function Roster({ pub, meId, onPlayer, scores }: { pub: PublicState; meId: string; onPlayer: (id: string) => void; scores?: boolean }) {
  const list = scores ? [...pub.players].sort((a, b) => b.score - a.score) : pub.players;
  return (
    <div className="roster">
      {list.map((p) => (
        <button key={p.id} type="button" className={`roster-item ${p.connected ? '' : 'off'}`} onClick={() => p.id !== meId && onPlayer(p.id)} aria-label={`${p.name} options`}>
          <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
          <span className="grow">
            <span className="nm row gap-s">
              {p.name}
              {p.isHost && <span style={{ color: 'var(--gold-hi)', display: 'inline-flex' }}><Icon name="crown" size={14} /></span>}
            </span>
            <span className="meta">
              {p.id === meId ? 'You' : p.connected ? 'At the table' : 'Reconnecting…'}
              {p.waiting ? ' · joins next game' : ''}
              {p.cam ? ' · live face' : ''}
              {p.mic ? ' · voice' : ''}
            </span>
          </span>
          {scores ? <span className="score">{p.score}</span> : pub.phase === 'lobby' && !p.isHost ? <span className={`pill ${p.ready ? 'ok' : ''}`}>{p.ready ? 'Ready' : 'Waiting'}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Lobby({ pub, isHost, meId, onPlayer }: { pub: PublicState; isHost: boolean; meId: string; onPlayer: (id: string) => void }) {
  const me = pub.players.find((p) => p.id === meId);
  const link = `${location.origin}/?room=${pub.code}`;
  const connected = pub.players.filter((p) => p.connected).length;
  const min = MODES[pub.settings.mode].minPlayers;
  const unready = pub.players.filter((p) => p.connected && !p.isHost && !p.ready).length;
  const share = async () => {
    const data = { title: 'IMPOSTERVERSE LIVE', text: `Join my table — room code ${pub.code}`, url: link };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    showNotice((await copyText(link)) ? 'Invite link copied.' : link);
  };
  return (
    <>
      <div className="side-head col gap-s">
        <div className="code-box">
          <div>
            <div className="label">Room code</div>
            <div className="code">{pub.code}</div>
          </div>
          <div className="row gap-s">
            <IconButton icon="copy" label="Copy room code" onClick={async () => showNotice((await copyText(pub.code)) ? 'Room code copied.' : pub.code)} />
            <IconButton icon="share" label="Invite friends" on onClick={share} />
          </div>
        </div>
      </div>
      <div className="side-body">
        <div>
          <div className="section-title">Players · {pub.players.length}/{pub.settings.maxPlayers}</div>
          <Roster pub={pub} meId={meId} onPlayer={onPlayer} />
        </div>
        <div>
          <div className="section-title">Session setup</div>
          <Rules pub={pub} editable={isHost} />
        </div>
      </div>
      <div className="side-foot">
        {isHost ? (
          <>
            <Button variant="primary" wide disabled={connected < min} onClick={() => net.send({ t: 'start' })}>
              {connected < min ? `Need ${min - connected} more player${min - connected === 1 ? '' : 's'}` : `Start · ${pub.settings.games} game${pub.settings.games === 1 ? '' : 's'}, ${pub.settings.rounds} clue round${pub.settings.rounds === 1 ? '' : 's'} each`}
            </Button>
            {connected >= min && unready > 0 && <div className="tiny faint center">{unready} player{unready === 1 ? ' is' : 's are'} not ready yet — you can still start.</div>}
          </>
        ) : (
          <>
            <Button variant={me?.ready ? 'ghost' : 'primary'} wide onClick={() => net.send({ t: 'ready', ready: !me?.ready })}>
              {me?.ready ? 'Not ready' : 'I am ready'}
            </Button>
            <div className="tiny faint center">The host sets up the session and starts it.</div>
          </>
        )}
      </div>
    </>
  );
}

const secs = (v: number) => (v >= 60 && v % 60 === 0 ? `${v / 60} min` : `${v}s`);


// ---- in-round panels ------------------------------------------------------

function Secret({ priv, pub, big, onRevealed }: { priv: PrivateState; pub: PublicState; big?: boolean; onRevealed?: () => void }) {
  const imp = priv.role === 'imposter';
  return (
    <div className={big ? '' : 'peek'}>
      <HoldCard tone={imp ? 'imposter' : 'crew'} onRevealed={onRevealed}>
        <div className="eyebrow">{imp ? 'You are' : 'Your secret word'}</div>
        <div className="word">{imp ? 'The Imposter' : priv.word}</div>
        <div className="tiny muted">{imp && big ? 'You do not know the secret word. Listen carefully and blend in.' : `Category · ${categoryName(pub.category)}`}</div>
      </HoldCard>
    </div>
  );
}

function ClueList({ pub, nameOf, meId }: { pub: PublicState; nameOf: (id: string) => string; meId?: string }) {
  const rows = pub.clues.map((c, i) => ({ ...c, i }));
  return (
    <div className="clue-list">
      {rows.map((c) => (
        <Fragment key={c.i}>
          {/* with more than one clue round, the list is grouped so it is clear which round a clue belongs to */}
          {pub.settings.rounds > 1 && (c.i === 0 || rows[c.i - 1].round !== c.round) && <div className="clue-round">Clue round {c.round}</div>}
          <div className="clue-row">
            <span className="ord">{c.i + 1}</span>
            <span className="who">{nameOf(c.playerId)}{c.playerId === meId ? ' (you)' : ''}</span>
            <span className={`what ${c.text ? '' : 'pass'}`}>{c.text || 'passed'}</span>
          </div>
        </Fragment>
      ))}
      {pub.phase === 'clue' && pub.currentId && pub.settings.rounds > 1 && (rows.length === 0 || rows[rows.length - 1].round !== pub.round) && <div className="clue-round">Clue round {pub.round}</div>}
      {pub.phase === 'clue' && pub.currentId && (
        <div className="clue-row current">
          <span className="ord">{pub.clues.length + 1}</span>
          <span className="who">{nameOf(pub.currentId)}{pub.currentId === meId ? ' (you)' : ''}</span>
          <span className="what pass">thinking…</span>
        </div>
      )}
    </div>
  );
}

function Head({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="side-head">
      <div className="eyebrow">{eyebrow}</div>
      <h3 className="display" style={{ fontSize: 19, marginTop: 6 }}>{title}</h3>
      {sub && <p className="small muted" style={{ marginTop: 6 }}>{sub}</p>}
    </div>
  );
}



function Discussion({ pub, priv, isHost, nameOf }: { pub: PublicState; priv: PrivateState; isHost: boolean; nameOf: (id: string) => string }) {
  return (
    <>
      <Head eyebrow={`${gameLabel(pub)} · Discussion time`} title="Everyone can speak now" sub="All the clue rounds are done. Microphones are open: accuse, defend, ask questions. The vote opens when the timer ends." />
      <div className="side-body">
        <Secret priv={priv} pub={pub} />
        <ClueList pub={pub} nameOf={nameOf} />
      </div>
      <div className="side-foot">
        <Button variant="ghost" wide onClick={() => net.setChatOpen(true)}>Open chat</Button>
        {isHost && <Button variant="primary" wide onClick={() => net.send({ t: 'advance' })}>Go to the vote</Button>}
      </div>
    </>
  );
}


function Spectating({ pub, priv, nameOf }: { pub: PublicState; priv: PrivateState; nameOf: (id: string) => string }) {
  return (
    <>
      <Head eyebrow={gameLabel(pub)} title="Watching this game" sub={priv.instruction || 'You will be dealt in when the next game starts.'} />
      <div className="side-body">
        <ClueList pub={pub} nameOf={nameOf} />
        {pub.phase === 'voting' && <div className="small muted">Ballots in: {pub.votedIds.length} / {pub.order.length}</div>}
      </div>
    </>
  );
}

function Reveal({ pub, meId, isHost, nameOf, earned, onPlayer }: { pub: PublicState; meId: string; isHost: boolean; nameOf: (id: string) => string; earned: { xp: number; unlocked: string[] } | null; onPlayer: (id: string) => void }) {
  const r = pub.reveal!;
  const voters = Object.keys(r.votes);
  return (
    <>
      <div className="side-head">
        <div className={`verdict ${r.outcome}`}>
          <div className="eyebrow">{gameLabel(pub)} · Results</div>
          <h2 className="display" style={{ marginTop: 8 }}>{r.outcome === 'caught' ? 'Imposter Caught!' : r.outcome === 'escaped' ? 'The Imposter Escaped!' : 'Game Voided'}</h2>
          {r.tie && <p className="small muted" style={{ marginTop: 8 }}>The vote was tied, so nobody was convicted — and that counts as an escape.</p>}
          {r.voidReason && <p className="small muted" style={{ marginTop: 8 }}>{r.voidReason} No points were awarded.</p>}
        </div>
      </div>
      <div className="side-body">
        <div className="reveal-word">
          <div className="label" style={{ marginBottom: 8 }}>The secret word · {categoryName(r.category)}</div>
          <b>{r.word}</b>
        </div>

        <div>
          <div className="section-title">{r.imposterIds.length > 1 ? 'The imposters' : 'The imposter'}</div>
          {r.imposterIds.map((id) => (
            <div key={id} className="vote-line">
              <span className="tag-imp">IMPOSTER</span>
              <b style={{ color: 'var(--ivory)' }}>{nameOf(id)}{id === meId ? ' (you)' : ''}</b>
              <span className="grow" />
              <span className="small muted">{r.outcome === 'void' ? '' : r.caughtIds.includes(id) ? 'caught · 0 pts' : `escaped · +${r.scoreDelta[id] ?? 0}`}</span>
            </div>
          ))}
        </div>

        {r.outcome !== 'void' && (
          <div>
            <div className="section-title">Who voted for whom</div>
            {voters.map((v) => (
              <div key={v} className="vote-line">
                <b style={{ color: 'var(--ivory)' }}>{nameOf(v)}</b>
                <span className="arrow">→</span>
                {r.votes[v].length ? (
                  <span>
                    {r.votes[v].map((t, i) => (
                      <span key={t} style={{ color: r.imposterIds.includes(t) ? 'var(--jade)' : 'var(--text)' }}>{i ? ', ' : ''}{nameOf(t)}</span>
                    ))}
                  </span>
                ) : (
                  <span className="faint">did not vote</span>
                )}
                <span className="grow" />
                {r.votes[v].some((t) => r.imposterIds.includes(t)) && <span style={{ color: 'var(--jade)', display: 'inline-flex' }}><Icon name="check" size={16} /></span>}
              </div>
            ))}
            <div className="chips" style={{ marginTop: 12 }}>
              {Object.entries(r.tally).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                <span key={id} className={`pill ${r.accusedIds.includes(id) ? 'gold' : ''}`}>{nameOf(id)} · {n}</span>
              ))}
              {r.accusedIds.length === 0 && <span className="pill">{r.tie ? 'Tied vote — nobody convicted' : 'No votes — nobody convicted'}</span>}
            </div>
          </div>
        )}

        <div>
          <div className="section-title">Session leaderboard</div>
          <Roster pub={pub} meId={meId} onPlayer={onPlayer} scores />
        </div>

        {earned && (
          <div className="card row between">
            <span className="small">You earned <b className="gold">+{earned.xp} XP</b>{earned.unlocked.length ? ` and ${earned.unlocked.length} new honour${earned.unlocked.length > 1 ? 's' : ''}` : ''}</span>
            <Icon name="star" />
          </div>
        )}
      </div>
      <div className="side-foot">
        {isHost ? (
          <>
            <Button variant="primary" wide onClick={() => net.send({ t: 'next' })}>
              {pub.game >= pub.settings.games ? 'See the final leaderboard now' : `Start game ${pub.game + 1} of ${pub.settings.games} now`}
            </Button>
            <Button variant="ghost" size="sm" wide onClick={() => net.send({ t: 'end' })}>End the session and return to lobby</Button>
          </>
        ) : (
          <div className="small muted center">{pub.game >= pub.settings.games ? 'The final leaderboard is coming up.' : `Game ${pub.game + 1} of ${pub.settings.games} starts by itself in a moment.`}</div>
        )}
      </div>
    </>
  );
}

// ---- overlays -------------------------------------------------------------

function Chat() {
  const chat = useNet((s) => s.chat);
  const meId = useProfile((s) => s.id);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length]);
  return (
    <Sheet title="Table chat" onClose={() => net.setChatOpen(false)}>
      <div className="chat-log" ref={log}>
        {chat.length === 0 && <div className="small faint">No messages yet. Say something suspicious.</div>}
        {chat.map((c, i) => (
          <div key={i} className={`chat-line ${c.id === meId ? 'mine' : ''}`}><b>{c.id === meId ? 'You' : c.name}</b>{c.text}</div>
        ))}
      </div>
      <form className="row gap-s" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) net.send({ t: 'chat', text: t }); setText(''); }}>
        <input className="input grow" value={text} maxLength={LIMITS.chatLength} placeholder="Message the table" aria-label="Message" autoComplete="off" enterKeyHint="send" onChange={(e) => setText(e.target.value)} />
        <Button variant="primary" type="submit" disabled={!text.trim()}>Send</Button>
      </form>
    </Sheet>
  );
}

function PlayerSheet({ id, pub, isHost, onClose }: { id: string; pub: PublicState; isHost: boolean; onClose: () => void }) {
  const p = pub.players.find((x) => x.id === id);
  const profile = useProfile();
  const [muted, setMuted] = useState(mesh.isMuted(id));
  const [reporting, setReporting] = useState(false);
  if (!p) return null;
  const blocked = profile.blocked.includes(id);
  const friend = profile.friends.some((f) => f.id === id);
  return (
    <Sheet title={p.name} onClose={onClose}>
      {reporting ? (
        <>
          <p className="small muted">Why are you reporting {p.name}? Reports are logged for the moderators of this server.</p>
          {['Offensive language', 'Inappropriate camera content', 'Harassment', 'Cheating or spoiling'].map((reason) => (
            <Button key={reason} variant="ghost" wide onClick={() => { net.send({ t: 'report', id, reason }); onClose(); }}>{reason}</Button>
          ))}
        </>
      ) : (
        <>
          <Button variant="ghost" wide onClick={() => { mesh.setMuted(id, !muted); setMuted(!muted); }}>
            <Icon name="volOff" size={16} /> {muted ? 'Unmute voice' : 'Mute voice'}
          </Button>
          <Button variant="ghost" wide disabled={friend} onClick={() => { profile.addFriend({ id, name: p.name }); showNotice(`${p.name} added to friends.`); onClose(); }}>
            <Icon name="plus" size={16} /> {friend ? 'Already a friend' : 'Add friend'}
          </Button>
          <Button variant="ghost" wide onClick={() => { profile.toggleBlock(id); mesh.setMuted(id, !blocked); onClose(); }}>
            <Icon name="block" size={16} /> {blocked ? 'Unblock' : 'Block (hide face, voice and chat)'}
          </Button>
          <Button variant="ghost" wide onClick={() => setReporting(true)}>
            <Icon name="flag" size={16} /> Report player
          </Button>
          {isHost && (
            <>
              <hr className="rule" />
              <Button variant="ghost" wide disabled={!p.connected} onClick={() => { net.send({ t: 'host', id }); onClose(); }}>
                <Icon name="crown" size={16} /> Make host
              </Button>
              <Button variant="danger" wide onClick={() => { net.send({ t: 'kick', id }); onClose(); }}>Remove from room</Button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---- match configuration ---------------------------------------------------


/**
 * The match setup everyone sees in the lobby. Only the host can change it.
 * A GAME is a set number of rounds; a ROUND is one word, one imposter, clues,
 * discussion and a vote.
 */

/** The fixed speaking order for this round, with the first speaker marked. */
function OrderStrip({ pub, nameOf, meId }: { pub: PublicState; nameOf: (id: string) => string; meId: string }) {
  const spoken = new Set(pub.clues.filter((c) => c.round === pub.round).map((c) => c.playerId));
  return (
    <div className="order-strip" aria-label="Speaking order">
      {pub.roundOrder.map((id, i) => (
        <span key={id} className={`order-seat ${pub.currentId === id ? 'now' : ''} ${spoken.has(id) ? 'done' : ''}`}>
          <i>{i + 1}</i>
          {nameOf(id)}{id === meId ? ' (you)' : ''}
        </span>
      ))}
    </div>
  );
}

// ---- round intro and private role -----------------------------------------

function Roles({ pub, priv, meId }: { pub: PublicState; priv: PrivateState; meId: string; isHost: boolean }) {
  const seen = pub.rolesSeenIds.includes(meId);
  const [peeked, setPeeked] = useState(false);
  const nameOf = (id: string) => pub.players.find((p) => p.id === id)?.name ?? 'Player';
  const waitingOn = pub.order.filter((id) => !pub.rolesSeenIds.includes(id)).length;
  return (
    <>
      <Head eyebrow={`${gameLabel(pub)} · ${pub.settings.rounds} clue round${pub.settings.rounds === 1 ? '' : 's'}`} title="Your secret role" sub={`${pub.starterId === meId ? 'You speak' : `${nameOf(pub.starterId ?? '')} speaks`} first in clue round 1. The first speaker moves one seat each clue round. Your word and role stay the same all game.`} />
      <div className="side-body">
        <OrderStrip pub={pub} nameOf={nameOf} meId={meId} />
        <Secret priv={priv} pub={pub} big onRevealed={() => setPeeked(true)} />
        <p className="small muted">{peeked ? priv.instruction : 'Shield your screen. Hold the card to look — it hides the moment you let go. Nobody else can see it.'}</p>
        <div className="progress-dots" aria-label="Players ready">
          {pub.order.map((id) => <i key={id} className={pub.rolesSeenIds.includes(id) ? 'on' : ''} />)}
        </div>
      </div>
      <div className="side-foot">
        <Button variant="primary" wide disabled={seen || !peeked} onClick={() => net.send({ t: 'seen' })}>
          {seen ? `Waiting for ${waitingOn} more…` : peeked ? 'I have seen it' : 'Hold the card first'}
        </Button>
        <div className="tiny faint center">Clues begin when everyone has looked at their card.</div>
      </div>
    </>
  );
}

// ---- the clue turn: speak it, check it, confirm it ------------------------

type ClueStage = 'ready' | 'recording' | 'processing' | 'review';

function Clues({ pub, priv, meId, isHost, nameOf, setTalking }: { pub: PublicState; priv: PrivateState; meId: string; isHost: boolean; nameOf: (id: string) => string; setTalking: (on: boolean) => void }) {
  const myTurn = pub.currentId === meId;
  const micOn = useMedia((s) => s.micOn);
  const [stage, setStage] = useState<ClueStage>('ready');
  const [draft, setDraft] = useState('');
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const sentTurn = useRef(-1);
  const turnRef = useRef(pub.turn);
  const session = useRef<Listening | null>(null);
  const input = useRef<HTMLInputElement>(null);
  turnRef.current = pub.turn;

  // A new turn always starts clean, and the microphone never stays open past it.
  useEffect(() => {
    session.current?.cancel();
    session.current = null;
    setTalking(false);
    setStage('ready');
    setDraft('');
    setHeard('');
    setNote('');
  }, [pub.turn, myTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { session.current?.cancel(); setTalking(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTalking = () => {
    if (!myTurn || stage === 'recording' || stage === 'processing' || sentTurn.current === pub.turn) return;
    setHeard('');
    setNote('');
    setTalking(true); // opens the mic gate: the table hears the real voice from here…
    session.current = listen(setHeard, () => setNote('Speech-to-text is not responding. Type your clue below.'));
    setStage('recording');
  };
  const stopTalking = async () => {
    if (stage !== 'recording') return;
    const turn = pub.turn;
    setTalking(false); // …to here
    setStage('processing');
    const raw = session.current ? await session.current.stop() : '';
    session.current = null;
    if (turnRef.current !== turn) return; // the turn ended while we were transcribing
    const text = tidyClue(raw, LIMITS.clueLength);
    setDraft(text);
    if (!text) setNote(speechSupported ? 'We did not catch that. Hold to speak again, or type it.' : 'This browser cannot turn speech into text. Everyone heard you — now type the clue you said.');
    setStage('review');
    setTimeout(() => input.current?.focus({ preventScroll: true }), 50);
  };
  const confirm = () => {
    const clue = draft.trim();
    if (!clue || sentTurn.current === pub.turn) return; // one clue per turn; once confirmed it is locked
    sentTurn.current = pub.turn;
    net.send({ t: 'clue', text: clue });
  };

  const sent = sentTurn.current === pub.turn;
  const speaker = nameOf(pub.currentId ?? '');
  return (
    <>
      <Head
        eyebrow={roundLabel(pub)}
        title={myTurn ? 'Your turn to speak' : `${speaker}’s turn`}
        sub={myTurn ? (priv.role === 'imposter' ? 'Bluff. Say one word that fits what the others have said.' : 'Say one word. Prove you know it without giving it away.') : 'Listen carefully. One of these clues is a bluff.'}
      />
      <div className="side-body">
        <OrderStrip pub={pub} nameOf={nameOf} meId={meId} />
        {myTurn && !sent && (
          <div className={`talk ${stage}`}>
            {(stage === 'ready' || stage === 'recording') && (
              <>
                <button
                  type="button"
                  className="ptt"
                  aria-label="Hold to speak your clue"
                  aria-pressed={stage === 'recording'}
                  disabled={!micOn}
                  onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); startTalking(); }}
                  onPointerUp={stopTalking}
                  onPointerCancel={stopTalking}
                  onLostPointerCapture={stopTalking}
                  onContextMenu={(e) => e.preventDefault()}
                  onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startTalking(); } }}
                  onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') void stopTalking(); }}
                >
                  <Icon name="mic" size={34} />
                </button>
                <div className="talk-state">{stage === 'recording' ? 'Listening — the table can hear you' : micOn ? 'Hold to speak your clue' : 'Your microphone is off'}</div>
                {stage === 'recording' && <div className="talk-heard">{heard || '…'}</div>}
                {!micOn && (
                  <Button size="sm" variant="primary" onClick={() => media.enableMic().then((ok) => !ok && setNote(useMedia.getState().micError || 'The microphone is unavailable. Type your clue instead.'))}>
                    Turn on microphone
                  </Button>
                )}
                <button type="button" className="link" onClick={() => { setStage('review'); setTimeout(() => input.current?.focus({ preventScroll: true }), 50); }}>Type it instead</button>
              </>
            )}
            {stage === 'processing' && (
              <>
                <div className="ptt busy" aria-hidden="true"><Icon name="mic" size={34} /></div>
                <div className="talk-state">Turning your words into text…</div>
              </>
            )}
            {stage === 'review' && (
              <form className="col" style={{ width: '100%' }} onSubmit={(e) => { e.preventDefault(); confirm(); }}>
                <div className="field">
                  <label htmlFor="clue-draft">{draft ? 'We heard this — fix it if it is wrong' : 'Your clue'}</label>
                  <input id="clue-draft" ref={input} className="input clue-draft" value={draft} maxLength={LIMITS.clueLength} placeholder="One word" aria-label="Your clue" autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" onChange={(e) => setDraft(e.target.value)} />
                </div>
                <div className="row gap-s">
                  <Button variant="ghost" className="grow" disabled={!micOn} onClick={() => { setDraft(''); setStage('ready'); }}>
                    <Icon name="mic" size={16} /> Speak again
                  </Button>
                  <Button variant="primary" type="submit" className="grow" disabled={!draft.trim()}>Confirm clue</Button>
                </div>
                <div className="tiny faint center">Once confirmed, your clue is locked and shown to everyone.</div>
              </form>
            )}
            {note && <div className="small" style={{ color: 'var(--rose)', textAlign: 'center' }}>{note}</div>}
          </div>
        )}
        {myTurn && sent && <div className="empty">Clue locked in.</div>}
        <Secret priv={priv} pub={pub} />
        <ClueList pub={pub} nameOf={nameOf} meId={meId} />
      </div>
      <div className="side-foot">
        {!myTurn && <div className="small muted center">{speaker} is speaking. {pub.round < pub.settings.rounds ? `Clue round ${pub.round + 1} follows straight after this one.` : 'Discussion opens after this clue round.'}</div>}
        {myTurn && !speechSupported && <div className="tiny faint center">This browser has no speech-to-text, so you will type the clue after saying it.</div>}
        {isHost && !myTurn && <Button variant="ghost" size="sm" wide onClick={() => net.send({ t: 'advance' })}>Skip this player</Button>}
      </div>
    </>
  );
}

// ---- voting: click the character ------------------------------------------

function Voting({ pub, priv, meId, nameOf, pick, setPick }: { pub: PublicState; priv: PrivateState; meId: string; nameOf: (id: string) => string; pick: string | null; setPick: (id: string | null) => void }) {
  const [sent, setSent] = useState(false);
  const locked = !!priv.myVotes;
  const lastClue = (id: string) => pub.clues.filter((c) => c.playerId === id).map((c) => c.text || 'passed').join(' · ');
  const suspects = pub.order.filter((id) => id !== meId);
  // A player you picked may have left; never keep a selection that is no longer at the table.
  useEffect(() => {
    if (pick && !pub.order.includes(pick)) setPick(null);
  }, [pick, pub.order]); // eslint-disable-line react-hooks/exhaustive-deps
  const cast = () => {
    if (sent || locked || !pick) return; // one ballot per round
    setSent(true);
    sfx.vote();
    net.send({ t: 'vote', targets: [pick] });
    setTimeout(() => setSent(false), 2500); // lets you retry if the server rejected it
  };
  const accused = locked ? priv.myVotes![0] : pick;
  return (
    <>
      <Head
        eyebrow={`${gameLabel(pub)} · The vote`}
        title={locked ? 'Vote locked in' : 'Who is the imposter?'}
        sub={locked ? 'Votes stay sealed until everyone has voted.' : 'Tap the character you suspect at the table. Microphones are muted while everyone decides.'}
      />
      <div className="side-body">
        {accused ? (
          <div className={`accuse ${locked ? 'locked' : ''}`}>
            <div className="label">{locked ? 'You accused' : 'Accuse this player?'}</div>
            <div className="nm">{nameOf(accused)}</div>
            <div className="cl">Their clue: {lastClue(accused) || '—'}</div>
          </div>
        ) : (
          <div className="empty">Nobody selected yet. Tap a character at the table.</div>
        )}
        {!locked && (
          <div className="field">
            <span className="label">Or choose by name</span>
            <div className="chips">
              {suspects.map((id) => (
                <button key={id} type="button" className={`chip ${pick === id ? 'on' : ''}`} aria-pressed={pick === id} onClick={() => { sfx.tap(); setPick(id); }}>{nameOf(id)}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="label">Ballots in</span>
            <span className="small mono">{pub.votedIds.length} / {pub.order.length}</span>
          </div>
          <div className="progress-dots">{pub.order.map((id) => <i key={id} className={pub.votedIds.includes(id) ? 'on' : ''} />)}</div>
        </div>
        <Secret priv={priv} pub={pub} />
      </div>
      <div className="side-foot">
        {locked ? (
          <Button variant="ghost" wide disabled>Waiting for the others…</Button>
        ) : pick ? (
          <div className="row gap-s">
            <Button variant="ghost" className="grow" onClick={() => setPick(null)}>Cancel</Button>
            <Button variant="danger" className="grow" disabled={sent} onClick={cast}>Confirm vote</Button>
          </div>
        ) : (
          <Button variant="danger" wide disabled>Tap a character to accuse</Button>
        )}
        {!locked && <div className="tiny faint center">You cannot change your vote once it is confirmed.</div>}
      </div>
    </>
  );
}

// ---- end of game ----------------------------------------------------------

// ---- session setup ---------------------------------------------------------

const GAME_PRESETS = [1, 2, 3, 5];
const ROUND_PRESETS = [1, 2, 3];

/**
 * The session setup everyone sees in the lobby. Only the host can change it.
 * Two separate settings: how many GAMES in the session, and how many CLUE ROUNDS in each game.
 */
function Rules({ pub, editable }: { pub: PublicState; editable: boolean }) {
  const s = pub.settings;
  const set = (patch: Partial<Settings>) => net.send({ t: 'settings', settings: patch });
  const players = pub.players.filter((p) => p.connected).length;
  const minutes = estimateMinutes(s, Math.max(players, LIMITS.minPlayers));
  const facts: [string, string][] = [
    ['Games', s.games === 1 ? '1 game' : `${s.games} games`],
    ['Clue rounds', `${s.rounds} per game`],
    ['Imposters', '1 per game'],
    ['Players', `${players} at the table`],
    ['Mode', MODES[s.mode].name],
    ['Length', `About ${minutes} min`],
  ];
  const row = (title: string, control: React.ReactNode, hint?: string) => (
    <div className="setting" style={{ padding: '10px 0' }}>
      <div className="grow">
        <div className="t small">{title}</div>
        {hint && <div className="d tiny">{hint}</div>}
      </div>
      {control}
    </div>
  );
  const presets = (title: string, hint: string, value: number, options: number[], max: number, unit: string, onChange: (v: number) => void) => (
    <div className="setting" style={{ padding: '10px 0', flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="row between">
        <div className="grow">
          <div className="t small">{title}</div>
          <div className="d tiny">{hint}</div>
        </div>
        <Stepper value={value} min={1} max={max} onChange={onChange} />
      </div>
      <div className="chips">
        {options.map((n) => (
          <button key={n} type="button" className={`chip ${value === n ? 'on' : ''}`} onClick={() => { sfx.tap(); onChange(n); }}>{n} {unit}{n === 1 ? '' : 's'}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="col">
      <div className="match-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <p className="tiny faint">
        Each game has one secret word and one imposter. Everyone gives one clue in each of the {s.rounds} clue round{s.rounds === 1 ? '' : 's'}, with the first speaker moving one seat each round. Then comes one discussion, one vote and the results. Scores add up across all {s.games} game{s.games === 1 ? '' : 's'}.
      </p>

      {editable ? (
        <div>
          {presets('Games in this session', 'Each game has a new word and a new imposter', s.games, GAME_PRESETS, 10, 'game', (v) => set({ games: v }))}
          {presets('Clue rounds per game', 'Everyone gives one clue in every clue round', s.rounds, ROUND_PRESETS, 6, 'round', (v) => set({ rounds: v }))}
          {row(
            'Word category',
            <select className="input" style={{ width: 170, height: 42, fontSize: 14 }} value={s.category} aria-label="Word category" onChange={(e) => set({ category: e.target.value })}>
              <option value="random">Random</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>,
          )}
          {row('Speaking time', <Stepper value={s.clueSeconds} min={10} max={120} step={5} format={secs} onChange={(v) => set({ clueSeconds: v })} />, 'Per player, per clue')}
          {row('Discussion', <Stepper value={s.discussionSeconds} min={15} max={300} step={15} format={secs} onChange={(v) => set({ discussionSeconds: v })} />)}
          {row('Voting', <Stepper value={s.votingSeconds} min={15} max={120} step={15} format={secs} onChange={(v) => set({ votingSeconds: v })} />)}
          {row('Player limit', <Stepper value={s.maxPlayers} min={Math.max(LIMITS.minPlayers, pub.players.length)} max={LIMITS.maxPlayers} onChange={(v) => set({ maxPlayers: v })} />)}
          {row(
            'Scoring',
            <div className="chips">
              <button type="button" className={`chip ${s.scoring === 'classic' ? 'on' : ''}`} onClick={() => set({ scoring: 'classic' })}>Classic</button>
              <button type="button" className={`chip ${s.scoring === 'detective' ? 'on' : ''}`} onClick={() => set({ scoring: 'detective' })}>Detective</button>
            </div>,
            s.scoring === 'classic' ? 'Imposter scores 1 for escaping' : 'Crew also score 1 for a catch',
          )}
        </div>
      ) : (
        <div>
          {([
            ['Word category', categoryName(s.category)],
            ['Speaking time', secs(s.clueSeconds)],
            ['Discussion', secs(s.discussionSeconds)],
            ['Voting', secs(s.votingSeconds)],
            ['Scoring', s.scoring === 'classic' ? 'Classic' : 'Detective'],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="setting" style={{ padding: '9px 0' }}>
              <span className="muted small">{k}</span>
              <span style={{ fontWeight: 700, color: 'var(--ivory)' }}>{v}</span>
            </div>
          ))}
          <p className="tiny faint">Only the host can change the session settings.</p>
        </div>
      )}
    </div>
  );
}

// ---- final session leaderboard --------------------------------------------

function GameOver({ pub, meId, isHost, onLeave, onPlayer }: { pub: PublicState; meId: string; isHost: boolean; onLeave: () => void; onPlayer: (id: string) => void }) {
  const ranked = [...pub.players].sort((a, b) => b.score - a.score || b.won - a.won || a.caught - b.caught);
  const top = ranked[0]?.score ?? 0;
  const winners = ranked.filter((p) => p.score === top);
  const nameIn = (h: { names: Record<string, string> }, id: string) => pub.players.find((p) => p.id === id)?.name ?? h.names[id] ?? 'Player';
  const title = top === 0 ? 'Nobody got away with it' : winners.length === 1 ? `${winners[0].id === meId ? 'You win' : `${winners[0].name} wins`}!` : `${winners.map((w) => w.name).join(' & ')} share the win`;
  return (
    <>
      <div className="side-head">
        <div className="verdict caught">
          <div className="eyebrow">Session complete · {pub.history.length} game{pub.history.length === 1 ? '' : 's'} played</div>
          <h2 className="display" style={{ marginTop: 8 }}>{title}</h2>
        </div>
      </div>
      <div className="side-body">
        <div>
          <div className="section-title">Final session leaderboard</div>
          <div className="roster">
            {ranked.map((p, i) => (
              <button key={p.id} type="button" className={`roster-item final ${p.score === top && top > 0 ? 'winner' : ''}`} onClick={() => p.id !== meId && onPlayer(p.id)}>
                <span className="rank">{i + 1}</span>
                <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  <span className="nm">{p.name}{p.id === meId ? ' (you)' : ''}</span>
                  <span className="meta">Won {p.won} game{p.won === 1 ? '' : 's'} · escaped {p.escapes} · caught {p.caught}</span>
                </span>
                <span className="score">{p.score}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">Game by game</div>
          {pub.history.map((h) => (
            <div key={h.game} className="game-line">
              <span className="num">{h.game}</span>
              <span className="grow">
                <b>{h.word}</b>
                <span className="meta">
                  Imposter: {h.imposterIds.map((id) => nameIn(h, id)).join(', ')} · {h.outcome === 'caught' ? 'caught' : h.outcome === 'escaped' ? (h.tie ? 'escaped on a tied vote' : 'escaped') : 'game voided'}
                </span>
              </span>
              <span className="pts">
                {Object.entries(h.scoreDelta).filter(([, d]) => d > 0).map(([id, d]) => `${nameIn(h, id)} +${d}`).join(', ') || 'No points'}
              </span>
            </div>
          ))}
        </div>
        <p className="tiny faint">Scores are the total across every game of this session. An imposter scores 1 for each game they escape; a tied vote counts as an escape.</p>
      </div>
      <div className="side-foot">
        {isHost ? (
          <>
            <Button variant="primary" wide onClick={() => net.send({ t: 'next' })}>Play again · {pub.settings.games} game{pub.settings.games === 1 ? '' : 's'}</Button>
            <div className="row gap-s">
              <Button variant="ghost" size="sm" className="grow" onClick={() => net.send({ t: 'end' })}>Return to lobby</Button>
              <Button variant="ghost" size="sm" className="grow" onClick={onLeave}>Leave room</Button>
            </div>
          </>
        ) : (
          <>
            <div className="small muted center">Waiting for the host to play again or return to the lobby.</div>
            <Button variant="ghost" size="sm" wide onClick={onLeave}>Leave room</Button>
          </>
        )}
      </div>
    </>
  );
}
