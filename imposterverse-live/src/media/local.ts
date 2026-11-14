// The local player's camera and microphone. Both are strictly opt-in, can be
// switched off instantly, and are never recorded or stored.
import { create } from 'zustand';
import { FacePipeline, listCameras, type FaceStatus } from '../face/pipeline';
import { mesh } from '../net/rtc';
import { net, useNet } from '../net/client';
import { usePrefs, useProfile } from '../state/app';

interface MediaState {
  camOn: boolean;
  camStatus: FaceStatus;
  camError: string;
  faceLive: boolean;
  micOn: boolean;
  micError: string;
  /** Whether the microphone is currently allowed to transmit (see media.setGate). */
  gate: boolean;
  cameras: MediaDeviceInfo[];
  cameraId: string | undefined;
}

export const useMedia = create<MediaState>(() => ({
  camOn: false,
  camStatus: 'off',
  camError: '',
  faceLive: false,
  micOn: false,
  micError: '',
  gate: true,
  cameras: [],
  cameraId: undefined,
}));

export const face = new FacePipeline();

let outTrack: MediaStreamTrack | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let restarts = 0;
let gateOpen = true;

function announce() {
  const s = useMedia.getState();
  // Others only switch to our live face while one is actually being tracked.
  net.send({ t: 'media', cam: s.camOn && s.faceLive, mic: s.micOn });
}

function applyPrefs() {
  const p = usePrefs.getState();
  face.mode = p.maskMode === 'lite' || p.lowData ? 'lite' : 'segment';
  face.fps = p.lowData ? 10 : 20;
  mesh.setLowData(p.lowData);
}
usePrefs.subscribe(applyPrefs);
applyPrefs();

face.subscribe(() => {
  const prev = useMedia.getState();
  const faceLive = face.status === 'live';
  useMedia.setState({ camStatus: face.status, camError: face.error, faceLive });
  if (prev.faceLive !== faceLive) announce();
});

// Camera interruption (unplugged, taken by another app, phone call): try to bring it back.
face.onEnded = () => {
  if (!useMedia.getState().camOn || restarts >= 3) {
    void media.disableCamera();
    return;
  }
  restarts++;
  setTimeout(() => {
    if (useMedia.getState().camOn) void media.enableCamera(undefined, true);
  }, 1200 * restarts);
};

function setSpeaking(on: boolean) {
  const id = useProfile.getState().id;
  if (!!useNet.getState().speaking[id] === on) return;
  useNet.setState({ speaking: { ...useNet.getState().speaking, [id]: on } });
  net.send({ t: 'speaking', on });
}

export const media = {
  async enableCamera(deviceId?: string, isRestart = false): Promise<boolean> {
    if (!isRestart) restarts = 0;
    useMedia.setState({ camOn: true, camError: '' });
    try {
      await face.start(deviceId ?? useMedia.getState().cameraId);
    } catch {
      useMedia.setState({ camOn: false });
      announce();
      return false;
    }
    if (!outTrack || outTrack.readyState !== 'live') {
      // The stream other players receive is the processed cutout canvas — never the raw camera.
      outTrack = face.canvas.captureStream(20).getVideoTracks()[0];
      outTrack.contentHint = 'motion';
    }
    mesh.setLocal('video', outTrack);
    useMedia.setState({ cameras: await listCameras(), cameraId: face.deviceId });
    announce();
    return true;
  },

  async disableCamera() {
    face.stop();
    mesh.setLocal('video', null);
    outTrack?.stop();
    outTrack = null;
    useMedia.setState({ camOn: false, faceLive: false });
    announce();
  },

  async selectCamera(deviceId: string) {
    useMedia.setState({ cameraId: deviceId });
    if (useMedia.getState().camOn) await media.enableCamera(deviceId);
  },

  async enableMic(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? 'No microphone support.' : 'Microphone needs a secure (https) connection.');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const track = micStream.getAudioTracks()[0];
      track.enabled = gateOpen; // respect the current phase straight away
      track.addEventListener('ended', () => void media.disableMic());
      mesh.setLocal('audio', track);
      useMedia.setState({ micOn: true, micError: '' });

      // Voice-activity meter drives the "speaking" indicator.
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AC();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(micStream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let quietSince = 0;
      levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        // While the gate is closed nothing is being sent, so nobody is "speaking".
        const loud = gateOpen && Math.sqrt(sum / buf.length) > 0.045;
        const now = Date.now();
        if (loud) {
          quietSince = 0;
          setSpeaking(true);
        } else {
          if (!quietSince) quietSince = now;
          if (now - quietSince > 450) setSpeaking(false);
        }
      }, 110);
      announce();
      return true;
    } catch (e: any) {
      const message = e?.name === 'NotAllowedError' ? 'Microphone permission was declined.' : e?.name === 'NotFoundError' ? 'No microphone was found.' : e?.message || 'The microphone could not be started.';
      useMedia.setState({ micOn: false, micError: message });
      return false;
    }
  },

  async disableMic() {
    if (levelTimer) clearInterval(levelTimer);
    levelTimer = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    mesh.setLocal('audio', null);
    setSpeaking(false);
    useMedia.setState({ micOn: false });
    announce();
  },

  /**
   * Opens or closes the microphone gate without giving up the device.
   * The game uses this for push-to-talk during clues, open mics during
   * discussion and silence during the vote. A closed gate sends no audio at all.
   */
  setGate(open: boolean) {
    if (gateOpen === open) return;
    gateOpen = open;
    micStream?.getAudioTracks().forEach((t) => (t.enabled = open));
    if (!open) setSpeaking(false);
    useMedia.setState({ gate: open });
  },

  /** Re-send our media flags, e.g. after joining or rejoining a room. */
  announce,

  stopAll() {
    void media.disableCamera();
    void media.disableMic();
  },
};

// The server forgets our media flags when the socket drops; re-announce after (re)joining.
useNet.subscribe((s, prev) => {
  if (s.session && s.conn === 'open' && (!prev.session || prev.conn !== 'open')) setTimeout(announce, 400);
});

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    if (useMedia.getState().camOn) useMedia.setState({ cameras: await listCameras() });
  });
}
