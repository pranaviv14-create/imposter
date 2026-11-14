// Peer-to-peer media mesh. Each pair of players in a room holds one
// RTCPeerConnection carrying the packed face-cutout video and (optionally) voice.
// The game server only relays the signalling messages; media never touches it.
import { create } from 'zustand';
import type { IceServer } from '../../shared/types';

export interface RemotePeer {
  el: HTMLVideoElement;
  hasVideo: boolean;
  state: RTCPeerConnectionState;
}

/** React-facing view of who we currently have media from. */
export const useRtc = create<{ peers: Record<string, RemotePeer> }>(() => ({ peers: {} }));

type Kind = 'video' | 'audio';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Partial<Record<Kind, RTCRtpSender>>;
  remote: MediaStream;
  el: HTMLVideoElement;
}

const peers = new Map<string, Peer>();
const local: Record<Kind, MediaStreamTrack | null> = { video: null, audio: null };
const localStream = new MediaStream();
const muted = new Set<string>();
let wanted = new Set<string>();
let allowed: Set<string> | null = null;
const audible = (id: string) => allowed === null || allowed.has(id);
let ice: IceServer[] = [];
let myId = '';
let lowData = false;
let sendSignal: (to: string, data: unknown) => void = () => {};
let holder: HTMLDivElement | null = null;

function mediaHolder() {
  if (!holder) {
    // Video elements must be in the document for mobile Safari to keep decoding them.
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(holder);
  }
  return holder;
}

function publish() {
  const view: Record<string, RemotePeer> = {};
  for (const p of peers.values()) {
    view[p.id] = { el: p.el, hasVideo: p.remote.getVideoTracks().some((t) => t.readyState === 'live'), state: p.pc.connectionState };
  }
  useRtc.setState({ peers: view });
}

function tune(peer: Peer) {
  const sender = peer.senders.video;
  if (!sender || !sender.track) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    // The cutout is small, so a modest ceiling is plenty; WebRTC adapts below it on weak links.
    params.encodings[0].maxBitrate = lowData ? 90_000 : 320_000;
    params.encodings[0].maxFramerate = lowData ? 10 : 20;
    void sender.setParameters(params).catch(() => {});
  } catch {
    /* not supported — default adaptation still applies */
  }
}

function applyTrack(peer: Peer, kind: Kind) {
  const track = local[kind];
  const sender = peer.senders[kind];
  if (sender) void sender.replaceTrack(track).catch(() => {});
  else if (track) peer.senders[kind] = peer.pc.addTrack(track, localStream);
  if (kind === 'video') tune(peer);
}

function createPeer(id: string): Peer {
  const pc = new RTCPeerConnection({ iceServers: ice as RTCIceServer[] });
  const el = document.createElement('video');
  el.autoplay = true;
  el.playsInline = true;
  el.muted = muted.has(id) || !audible(id);
  mediaHolder().appendChild(el);
  const peer: Peer = { id, pc, polite: myId < id, makingOffer: false, ignoreOffer: false, senders: {}, remote: new MediaStream(), el };
  el.srcObject = peer.remote;

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(id, { description: pc.localDescription });
    } catch (e) {
      console.warn('[rtc] offer failed', e);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal(id, { candidate });
  };
  pc.ontrack = ({ track }) => {
    if (!peer.remote.getTracks().includes(track)) peer.remote.addTrack(track);
    track.addEventListener('ended', () => {
      peer.remote.removeTrack(track);
      publish();
    });
    track.addEventListener('unmute', publish);
    void el.play().catch(() => {
      // Autoplay with sound was blocked: retry on the next tap.
      const retry = () => void el.play().catch(() => {});
      window.addEventListener('pointerdown', retry, { once: true });
    });
    publish();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') tune(peer);
    if (pc.connectionState === 'failed') pc.restartIce();
    publish();
  };

  peers.set(id, peer);
  applyTrack(peer, 'video');
  applyTrack(peer, 'audio');
  publish();
  return peer;
}

function closePeer(id: string) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.onnegotiationneeded = null;
  peer.pc.onicecandidate = null;
  peer.pc.ontrack = null;
  peer.pc.onconnectionstatechange = null;
  peer.pc.close();
  peer.el.srcObject = null;
  peer.el.remove();
  peers.delete(id);
}

export const mesh = {
  configure(opts: { myId: string; ice: IceServer[]; send: (to: string, data: unknown) => void }) {
    myId = opts.myId;
    ice = opts.ice;
    sendSignal = opts.send;
  },

  /** Make the set of live connections match the set of reachable players. */
  sync(ids: string[]) {
    if (!myId) return;
    const want = new Set(ids.filter((id) => id !== myId));
    wanted = want;
    let changed = false;
    for (const id of [...peers.keys()]) {
      if (!want.has(id)) {
        closePeer(id);
        changed = true;
      }
    }
    // A connection is only worth opening once somebody has something to send;
    // the side with media makes the first offer, and the other side is created on demand.
    if (local.video || local.audio) {
      for (const id of want) if (!peers.has(id)) createPeer(id);
    }
    if (changed) publish();
  },

  async signal(from: string, data: any) {
    if (!myId || !data) return;
    const peer = peers.get(from) ?? createPeer(from);
    const pc = peer.pc;
    try {
      if (data.description) {
        const d = data.description as RTCSessionDescriptionInit;
        const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!peer.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.warn('[rtc] signalling error', e);
    }
  },

  setLocal(kind: Kind, track: MediaStreamTrack | null) {
    const prev = local[kind];
    if (prev && prev !== track) localStream.removeTrack(prev);
    local[kind] = track;
    if (track && !localStream.getTracks().includes(track)) localStream.addTrack(track);
    for (const peer of peers.values()) applyTrack(peer, kind);
    if (track && myId) for (const id of wanted) if (!peers.has(id)) createPeer(id);
  },

  setLowData(on: boolean) {
    lowData = on;
    for (const peer of peers.values()) tune(peer);
  },

  setMuted(id: string, on: boolean) {
    if (on) muted.add(id);
    else muted.delete(id);
    const peer = peers.get(id);
    if (peer) peer.el.muted = on || !audible(id);
  },

  /**
   * Which players may be heard right now, as decided by the game phase:
   * `null` = everyone, a set = only those ids (empty set = silence).
   * This backs up the sender-side gate, so a modified client cannot talk over a turn or a vote.
   */
  setAudible(ids: Set<string> | null) {
    allowed = ids;
    for (const peer of peers.values()) peer.el.muted = muted.has(peer.id) || !audible(peer.id);
  },
  isMuted: (id: string) => muted.has(id),

  closeAll() {
    for (const id of [...peers.keys()]) closePeer(id);
    myId = '';
    publish();
  },
};
