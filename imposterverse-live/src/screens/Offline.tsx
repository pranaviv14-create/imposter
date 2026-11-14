// Pass-the-phone mode. Runs entirely on this device with the same rules engine
// as online play — no connection and no camera needed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, LIMITS, type Reveal } from '../../shared/types';
import { MODES, gameTitle, maxImposters, scoreRound, tallyVotes, type RoundSecret } from '../../shared/engine';
import { CATEGORIES, categoryName } from '../../shared/words';
import { storage, useNav } from '../state/app';
import { Button, Confetti, HoldCard, Icon, IconButton, Mark, Page, Sheet, Stepper, TimerRing } from '../ui/kit';
import { sfx } from '../audio/sfx';

interface Setup {
  names: string[];
  imposters: number;
  category: string;
  clueSeconds: number; // 0 = no timer
  discussionSeconds: number;
}
const defaults: Setup = { names: ['', '', ''], imposters: 1, category: 'random', clueSeconds: 0, discussionSeconds: 90 };

type Stage = 'setup' | 'deal' | 'clues' | 'discuss' | 'vote' | 'reveal';

interface Round {
  secret: RoundSecret;
  order: number[]; // player indexes, in clue order
  clues: Record<number, string>;
  votes: Record<number, number | null>;
  result: (Pick<Reveal, 'outcome' | 'caughtIds' | 'escapedIds' | 'scoreDelta'> & { tally: Record<string, number>; accusedIds: string[] }) | null;
}

function useCountdown(seconds: number, key: unknown, onDone?: () => void) {
  const [left, setLeft] = useState(seconds);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    setLeft(seconds);
    if (!seconds) return;
    const end = Date.now() + seconds * 1000;
    let shown = seconds;
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      if (s !== shown && s <= 5 && s > 0) sfx.tick(s <= 3);
      shown = s;
      setLeft(s);
      if (s === 0) {
        clearInterval(id);
        done.current?.();
      }
    }, 200);
    return () => clearInterval(id);
  }, [seconds, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

export function Offline() {
  const go = useNav((s) => s.go);
  const [setup, setSetup] = useState<Setup>(() => {
    const saved = storage.get('offline', defaults);
    return { ...saved, names: saved.names?.length >= 3 ? saved.names : defaults.names };
  });
  const [stage, setStage] = useState<Stage>('setup');
  const [roundNo, setRoundNo] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [cursor, setCursor] = useState(0);
  const [peeked, setPeeked] = useState(false);
  const [ballotOpen, setBallotOpen] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [quit, setQuit] = useState(false);
  const used = useRef(new Set<string>());

  useEffect(() => storage.set('offline', setup), [setup]);

  const names = useMemo(() => setup.names.map((n, i) => n.trim() || `Player ${i + 1}`), [setup.names]);
  const n = names.length;
  const impMax = maxImposters(n);
  const imposters = Math.min(setup.imposters, impMax);
  const ids = names.map((_, i) => String(i));
  const duplicate = new Set(names.map((x) => x.toLowerCase())).size !== n;

  const deal = () => {
    const secret = MODES.classic.deal!(ids, { ...DEFAULT_SETTINGS, imposters, category: setup.category }, used.current, Math.random);
    const start = Math.floor(Math.random() * n);
    const order = Array.from({ length: n }, (_, i) => (start + i) % n);
    setRound({ secret, order, clues: {}, votes: {}, result: null });
    setRoundNo((r) => r + 1);
    if (scores.length !== n) setScores(Array(n).fill(0));
    setCursor(0);
    setPeeked(false);
    setStage('deal');
    sfx.role();
  };

  const finish = (votes: Record<number, number | null>) => {
    if (!round) return;
    const map: Record<string, string[]> = {};
    for (const id of ids) {
      const v = votes[Number(id)];
      map[id] = v === null || v === undefined ? [] : [String(v)];
    }
    const { tally, accusedIds } = tallyVotes(map, ids, round.secret.imposterIds.length);
    const result = { ...scoreRound('classic', ids, round.secret.imposterIds, accusedIds), tally, accusedIds };
    setRound({ ...round, votes, result });
    setScores((s) => s.map((v, i) => v + (result.scoreDelta[String(i)] ?? 0)));
    setStage('reveal');
    if (result.outcome === 'caught') sfx.caught();
    else sfx.escaped();
  };

  const back = () => (stage === 'setup' ? go('home') : setQuit(true));
  const title = stage === 'setup' ? 'Play offline' : gameTitle(roundNo);

  let body: React.ReactNode = null;

  if (stage === 'setup') {
    const setName = (i: number, v: string) => setSetup({ ...setup, names: setup.names.map((x, j) => (j === i ? v : x)) });
    body = (
      <>
        <p className="muted">One device, passed around the room. Everyone sees their secret privately, then you give clues out loud.</p>
        <div className="section-title">Players · {n}</div>
        <div className="col gap-s">
          {setup.names.map((name, i) => (
            <div key={i} className="name-row">
              <span className="avatar">{i + 1}</span>
              <input className="input grow" value={name} maxLength={LIMITS.nameLength} placeholder={`Player ${i + 1}`} aria-label={`Player ${i + 1} name`} onChange={(e) => setName(i, e.target.value)} />
              <IconButton icon="trash" label={`Remove player ${i + 1}`} className={n <= LIMITS.minPlayers ? 'off' : ''} onClick={() => n > LIMITS.minPlayers && setSetup({ ...setup, names: setup.names.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button variant="ghost" disabled={n >= LIMITS.maxPlayers} onClick={() => setSetup({ ...setup, names: [...setup.names, ''] })}>
            <Icon name="plus" size={16} /> Add player
          </Button>
          {duplicate && <div className="small" style={{ color: 'var(--rose)' }}>Two players share a name — make each one unique.</div>}
        </div>

        <div className="section-title">Rules</div>
        <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <div className="setting">
            <div className="grow"><div className="t">Imposters</div><div className="d">{impMax === 1 ? 'Add players to allow more' : `Up to ${impMax} with ${n} players`}</div></div>
            <Stepper value={imposters} min={1} max={impMax} onChange={(v) => setSetup({ ...setup, imposters: v })} />
          </div>
          <div className="setting">
            <div className="grow"><div className="t">Word category</div></div>
            <select className="input" style={{ width: 180, height: 44, fontSize: 14 }} value={setup.category} aria-label="Word category" onChange={(e) => setSetup({ ...setup, category: e.target.value })}>
              <option value="random">Random</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="setting">
            <div className="grow"><div className="t">Clue timer</div><div className="d">Per player</div></div>
            <Stepper value={setup.clueSeconds} min={0} max={120} step={15} format={(v) => (v ? `${v}s` : 'Off')} onChange={(v) => setSetup({ ...setup, clueSeconds: v })} />
          </div>
          <div className="setting">
            <div className="grow"><div className="t">Discussion</div></div>
            <Stepper value={setup.discussionSeconds} min={0} max={300} step={30} format={(v) => (v ? `${v}s` : 'Off')} onChange={(v) => setSetup({ ...setup, discussionSeconds: v })} />
          </div>
        </div>
        <Button variant="primary" wide disabled={duplicate} onClick={deal}>Deal the roles</Button>
        {scores.length === n && roundNo > 0 && <Button variant="ghost" wide onClick={() => { setScores([]); setRoundNo(0); }}>Reset scores</Button>}
      </>
    );
  }

  if (stage === 'deal' && round) {
    const isImp = round.secret.imposterIds.includes(String(cursor));
    const last = cursor === n - 1;
    body = (
      <div className="pass-screen">
        <div className="steps" style={{ width: '100%' }}>{names.map((_, i) => <i key={i} className={i <= cursor ? 'on' : ''} />)}</div>
        <div>
          <div className="eyebrow">Pass the phone to</div>
          <div className="who" style={{ marginTop: 10 }}>{names[cursor]}</div>
        </div>
        <div style={{ width: 'min(100%, 420px)' }}>
          {/* key forces a brand-new, face-down card for every player */}
          <HoldCard key={`${roundNo}-${cursor}`} big tone={isImp ? 'imposter' : 'crew'} onRevealed={() => setPeeked(true)}>
            <div className="eyebrow">{isImp ? 'You are' : 'The secret word'}</div>
            <div className="word">{isImp ? 'The Imposter' : round.secret.word}</div>
            <div className="small muted">{isImp ? `Category · ${categoryName(round.secret.category)}. Bluff and blend in.` : `Category · ${categoryName(round.secret.category)}`}</div>
          </HoldCard>
        </div>
        <p className="small muted">Only {names[cursor]} should look. Hold the card to reveal, release to hide.</p>
        <Button
          variant="primary"
          wide
          disabled={!peeked}
          onClick={() => {
            setPeeked(false);
            if (last) {
              setCursor(0);
              setStage('clues');
              sfx.roundStart();
            } else setCursor(cursor + 1);
          }}
        >
          {!peeked ? 'Hold the card first' : last ? 'Everyone has seen — start clues' : `Hidden — next player`}
        </Button>
      </div>
    );
  }

  if (stage === 'clues' && round) {
    body = <ClueStage key={roundNo} names={names} round={round} seconds={setup.clueSeconds} onClue={(i, text) => setRound({ ...round, clues: { ...round.clues, [i]: text } })} onDone={() => { setStage(setup.discussionSeconds ? 'discuss' : 'vote'); setCursor(0); setBallotOpen(false); setPick(null); sfx.votingOpen(); }} />;
  }

  if (stage === 'discuss' && round) {
    body = <DiscussStage names={names} round={round} seconds={setup.discussionSeconds} onDone={() => { setStage('vote'); setCursor(0); setBallotOpen(false); setPick(null); }} />;
  }

  if (stage === 'vote' && round) {
    const voter = cursor;
    const last = voter === n - 1;
    const lock = (choice: number | null) => {
      sfx.vote();
      const votes = { ...round.votes, [voter]: choice };
      setBallotOpen(false);
      setPick(null);
      if (last) finish(votes);
      else {
        setRound({ ...round, votes });
        setCursor(voter + 1);
      }
    };
    body = (
      <div className="pass-screen" style={{ justifyContent: 'flex-start' }}>
        <div className="steps" style={{ width: '100%' }}>{names.map((_, i) => <i key={i} className={i <= voter ? 'on' : ''} />)}</div>
        <div>
          <div className="eyebrow">{ballotOpen ? 'Secret ballot' : 'Pass the phone to'}</div>
          <div className="who" style={{ marginTop: 10 }}>{names[voter]}</div>
        </div>
        {!ballotOpen ? (
          <>
            <p className="muted">Vote in private. Nobody sees the ballots until everyone has voted.</p>
            <Button variant="primary" wide onClick={() => setBallotOpen(true)}>I am {names[voter]} — open my ballot</Button>
          </>
        ) : (
          <>
            <div className="vote-grid" style={{ width: '100%' }}>
              {names.map((name, i) => i !== voter && (
                <button key={i} type="button" className={`vote-option ${pick === i ? 'on' : ''}`} aria-pressed={pick === i} onClick={() => { sfx.tap(); setPick(i); }}>
                  <span className="nm">{name}</span>
                  <span className="cl">{round.clues[i] || '—'}</span>
                </button>
              ))}
            </div>
            <Button variant="danger" wide disabled={pick === null} onClick={() => lock(pick)}>{pick === null ? 'Choose a suspect' : `Accuse ${names[pick]}`}</Button>
            <Button variant="ghost" size="sm" wide onClick={() => lock(null)}>Abstain</Button>
          </>
        )}
      </div>
    );
  }

  if (stage === 'reveal' && round?.result) {
    const r = round.result;
    const board = names.map((name, i) => ({ name, i, score: scores[i] ?? 0 })).sort((a, b) => b.score - a.score);
    body = (
      <>
        {r.outcome === 'caught' && <Confetti />}
        <div className={`verdict ${r.outcome}`}>
          <div className="eyebrow">{gameTitle(roundNo)}</div>
          <h2 className="display" style={{ marginTop: 10 }}>{r.outcome === 'caught' ? 'Imposter Caught!' : 'The Imposter Escaped!'}</h2>
        </div>
        <div className="reveal-word">
          <div className="label" style={{ marginBottom: 8 }}>The secret word · {categoryName(round.secret.category)}</div>
          <b>{round.secret.word}</b>
        </div>
        <div>
          <div className="section-title">{round.secret.imposterIds.length > 1 ? 'The imposters' : 'The imposter'}</div>
          {round.secret.imposterIds.map((id) => (
            <div key={id} className="vote-line">
              <span className="tag-imp">IMPOSTER</span>
              <b style={{ color: 'var(--ivory)' }}>{names[Number(id)]}</b>
              <span className="grow" />
              <span className="small muted">{r.caughtIds.includes(id) ? 'caught · 0 pts' : 'escaped · +1'}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="section-title">Who voted for whom</div>
          {names.map((name, i) => {
            const v = round.votes[i];
            const hit = v !== null && v !== undefined && round.secret.imposterIds.includes(String(v));
            return (
              <div key={i} className="vote-line">
                <b style={{ color: 'var(--ivory)' }}>{name}</b>
                <span className="arrow">→</span>
                {v === null || v === undefined ? <span className="faint">abstained</span> : <span style={{ color: hit ? 'var(--jade)' : 'var(--text)' }}>{names[v]}</span>}
                <span className="grow" />
                {hit && <span style={{ color: 'var(--jade)', display: 'inline-flex' }}><Icon name="check" size={16} /></span>}
              </div>
            );
          })}
          {r.accusedIds.length === 0 && <div className="chips" style={{ marginTop: 12 }}><span className="pill">No majority — nobody convicted</span></div>}
        </div>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="roster">
            {board.map((p) => (
              <div key={p.i} className="roster-item">
                <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow nm">{p.name}</span>
                {(r.scoreDelta[String(p.i)] ?? 0) > 0 && <span className="delta">+{r.scoreDelta[String(p.i)]}</span>}
                <span className="score">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
        <Button variant="primary" wide onClick={deal}>Play the {gameTitle(roundNo + 1).toLowerCase()}</Button>
        <Button variant="ghost" wide onClick={() => setStage('setup')}>Change players or rules</Button>
      </>
    );
  }

  return (
    <>
      <Page title={title} onBack={back} actions={stage !== 'setup' ? <Mark size={30} /> : undefined}>
        {body}
      </Page>
      {quit && (
        <Sheet title="End this game?" onClose={() => setQuit(false)}>
          <p className="muted">The current round will be abandoned. Scores are kept until you reset them.</p>
          <Button variant="danger" wide onClick={() => { setQuit(false); setStage('setup'); }}>Back to setup</Button>
          <Button variant="ghost" wide onClick={() => { setQuit(false); go('home'); }}>Exit to menu</Button>
          <Button variant="ghost" wide onClick={() => setQuit(false)}>Keep playing</Button>
        </Sheet>
      )}
    </>
  );
}

function ClueStage({ names, round, seconds, onClue, onDone }: { names: string[]; round: Round; seconds: number; onClue: (i: number, text: string) => void; onDone: () => void }) {
  const [turn, setTurn] = useState(0);
  const [note, setNote] = useState('');
  const current = round.order[turn];
  const last = turn === round.order.length - 1;
  const next = () => {
    if (note.trim()) onClue(current, note.trim().slice(0, LIMITS.clueLength));
    setNote('');
    if (last) onDone();
    else {
      setTurn(turn + 1);
      sfx.turn();
    }
  };
  const left = useCountdown(seconds, turn, () => sfx.error());
  return (
    <>
      <div className="row between">
        <div>
          <div className="eyebrow">Clue {turn + 1} of {round.order.length}</div>
          <h3 className="display" style={{ fontSize: 'clamp(38px, 10vw, 56px)', marginTop: 6 }}>{names[current]}</h3>
          <p className="small muted" style={{ marginTop: 6 }}>Say one word or short phrase out loud.</p>
        </div>
        {seconds > 0 && <TimerRing seconds={left} total={seconds} />}
      </div>
      <div className="clue-list">
        {round.order.map((i, k) => (
          <div key={i} className={`clue-row ${k === turn ? 'current' : ''}`} style={{ opacity: k > turn ? 0.5 : 1 }}>
            <span className="ord">{k + 1}</span>
            <span className="who">{names[i]}</span>
            <span className={`what ${round.clues[i] ? '' : 'pass'}`}>{round.clues[i] ?? (k < turn ? 'spoken' : k === turn ? 'speaking…' : '')}</span>
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="note">Note the clue (optional)</label>
        <input id="note" className="input" value={note} maxLength={LIMITS.clueLength} placeholder={`What did ${names[current]} say?`} autoComplete="off" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && next()} />
      </div>
      <Button variant="primary" wide onClick={next}>{last ? 'All clues given — discuss' : `Next: ${names[round.order[turn + 1]]}`}</Button>
    </>
  );
}

function DiscussStage({ names, round, seconds, onDone }: { names: string[]; round: Round; seconds: number; onDone: () => void }) {
  const left = useCountdown(seconds, 'discuss', onDone);
  return (
    <>
      <div className="row between">
        <div>
          <div className="eyebrow">Discussion</div>
          <h3 className="display" style={{ fontSize: 'clamp(32px, 8vw, 44px)', marginTop: 6 }}>Who is bluffing?</h3>
          <p className="small muted" style={{ marginTop: 6 }}>Put the phone down and argue it out.</p>
        </div>
        <TimerRing seconds={left} total={seconds} />
      </div>
      <div className="clue-list">
        {round.order.map((i, k) => (
          <div key={i} className="clue-row">
            <span className="ord">{k + 1}</span>
            <span className="who">{names[i]}</span>
            <span className={`what ${round.clues[i] ? '' : 'pass'}`}>{round.clues[i] ?? 'spoken'}</span>
          </div>
        ))}
      </div>
      <Button variant="primary" wide onClick={onDone}>Go to the vote</Button>
    </>
  );
}
