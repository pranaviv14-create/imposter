// LIVE REAL-FACE CUTOUT PIPELINE
//
//   camera frame
//     -> MediaPipe FaceLandmarker (478 landmarks)      : where the head is
//     -> smoothed square crop around the head
//     -> MediaPipe ImageSegmenter (selfie model)       : person vs background
//     -> head-region matte from the jawline landmarks  : drops neck & shoulders
//     -> packed 512x256 frame:  [ colour | alpha matte ]
//
// WebRTC video has no alpha channel, so the matte travels side-by-side with the
// colour and every receiver recombines them in a shader (see FaceMaterial.ts).
// The pixels are always the player's real camera pixels — nothing is generated.
//
// Everything runs on-device. The raw camera frame never leaves the browser;
// only the head cutout is streamed, and only to peers in the same room.

import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

export const CUT = 256; // side of the square head crop
export const PACKED_W = CUT * 2;
export const PACKED_H = CUT;

// Face-oval landmark ring, clockwise from the top of the forehead (image space).
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const JAW_FROM = OVAL.indexOf(454);
const JAW_TO = OVAL.indexOf(234);

const CDN = {
  landmarker: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
  segmenter: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
};

export type FaceStatus = 'off' | 'requesting' | 'loading' | 'live' | 'searching' | 'error';
export type MaskMode = 'segment' | 'lite';

async function modelUrl(local: string, remote: string): Promise<string> {
  try {
    const r = await fetch(local, { method: 'HEAD' });
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return local;
  } catch {
    /* fall through to the CDN copy */
  }
  return remote;
}

interface Models {
  landmarker: FaceLandmarker;
  segmenter: ImageSegmenter | null;
}
let modelsPromise: Promise<Models> | null = null;

function loadModels(): Promise<Models> {
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const lmPath = await modelUrl('/models/face_landmarker.task', CDN.landmarker);
    const segPath = await modelUrl('/models/selfie_segmenter.tflite', CDN.segmenter);

    const makeLandmarker = (delegate: 'GPU' | 'CPU') =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: lmPath, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    const makeSegmenter = (delegate: 'GPU' | 'CPU') =>
      vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: segPath, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });

    let landmarker: FaceLandmarker;
    try {
      landmarker = await makeLandmarker('GPU');
    } catch {
      landmarker = await makeLandmarker('CPU');
    }
    let segmenter: ImageSegmenter | null = null;
    try {
      segmenter = await makeSegmenter('GPU');
    } catch {
      try {
        segmenter = await makeSegmenter('CPU');
      } catch (e) {
        console.warn('[face] segmenter unavailable, using landmark matte only', e);
      }
    }
    return { landmarker, segmenter };
  })();
  modelsPromise.catch(() => (modelsPromise = null));
  return modelsPromise;
}

function make(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: false })!];
}

export class FacePipeline {
  /** Packed [colour | matte] frame. This canvas is both the local texture and the WebRTC source. */
  readonly canvas: HTMLCanvasElement;
  status: FaceStatus = 'off';
  error = '';
  /** True while a face is currently being tracked. */
  hasFace = false;
  /** Which matte is actually in use this frame (segmentation can fall back to lite). */
  activeMode: MaskMode = 'lite';
  mode: MaskMode = 'segment';
  fps = 20;
  /** Rolling average of processing time per frame, in ms. */
  cost = 0;

  private out: CanvasRenderingContext2D;
  private crop: HTMLCanvasElement;
  private cropCtx: CanvasRenderingContext2D;
  private region: HTMLCanvasElement;
  private regionCtx: CanvasRenderingContext2D;
  private matte: HTMLCanvasElement;
  private matteCtx: CanvasRenderingContext2D;
  private person: HTMLCanvasElement;
  private personCtx: CanvasRenderingContext2D;
  private personData: ImageData | null = null;

  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private models: Models | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private lastFaceAt = 0;
  private haveCrop = false;
  private cx = 0;
  private cy = 0;
  private size = 0;
  private generation = 0;
  private lastStamp = 0;
  private personValid = false;
  private segFailures = 0;
  private listeners = new Set<() => void>();
  onEnded: (() => void) | null = null;

  constructor() {
    [this.canvas, this.out] = make(PACKED_W, PACKED_H);
    [this.crop, this.cropCtx] = make(CUT, CUT);
    [this.region, this.regionCtx] = make(48, 48);
    [this.matte, this.matteCtx] = make(CUT, CUT);
    [this.person, this.personCtx] = make(CUT, CUT);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.out.fillStyle = '#000';
    this.out.fillRect(0, 0, PACKED_W, PACKED_H);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private setStatus(status: FaceStatus, error = '') {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.listeners.forEach((fn) => fn());
  }

  /** Asks for the camera (this is what triggers the browser permission prompt) and starts processing. */
  async start(deviceId?: string): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.setStatus('requesting');
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', window.isSecureContext ? 'This browser has no camera support.' : 'Camera needs a secure (https) connection.');
      throw new Error(this.error);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (gen !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (this.stream === stream) {
          this.stop();
          this.setStatus('error', 'The camera was disconnected.');
          this.onEnded?.();
        }
      });
      this.video.srcObject = stream;
      await this.video.play();
      this.setStatus('loading');
      this.models = await loadModels();
      if (gen !== this.generation) return;
      this.running = true;
      this.haveCrop = false;
      this.setStatus('searching');
      this.raf = requestAnimationFrame(this.tick);
    } catch (e: any) {
      if (gen !== this.generation) return;
      this.stop();
      const name = e?.name ?? '';
      const message =
        name === 'NotAllowedError' ? 'Camera permission was declined.'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found.'
        : name === 'NotReadableError' ? 'The camera is in use by another app.'
        : e?.message || 'The camera could not be started.';
      this.setStatus('error', message);
      throw new Error(message);
    }
  }

  stop() {
    this.generation++;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.hasFace = false;
    this.out.fillStyle = '#000';
    this.out.fillRect(0, 0, PACKED_W, PACKED_H);
    this.setStatus('off');
  }

  get deviceId(): string | undefined {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  /** A transparent PNG of the current cutout, for the profile portrait. Stays on this device. */
  snapshot(size = 160): string | null {
    if (!this.hasFace) return null;
    const [c, ctx] = make(size, size);
    ctx.drawImage(this.crop, 0, 0, size, size);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.matte, 0, 0, size, size);
    return c.toDataURL('image/png');
  }

  private tick = () => {
    if (!this.running) return;
    const now = performance.now();
    const v = this.video;
    if (now - this.last >= 1000 / this.fps - 2 && v.readyState >= 2 && v.videoWidth > 0) {
      this.last = now;
      try {
        this.process(now);
      } catch (e) {
        console.warn('[face] frame failed', e);
      }
      this.cost = this.cost * 0.9 + (performance.now() - now) * 0.1;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private process(clock: number) {
    // MediaPipe rejects every later frame if a timestamp ever goes backwards, so never let it.
    const now = Math.max(clock, this.lastStamp + 1);
    this.lastStamp = now;
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const models = this.models!;

    const found = models.landmarker.detectForVideo(v, now).faceLandmarks?.[0];
    if (found) {
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const i of OVAL) {
        const p = found[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const fw = (maxX - minX) * vw;
      const fh = (maxY - minY) * vh;
      const tx = ((minX + maxX) / 2) * vw;
      const ty = ((minY + maxY) / 2) * vh - fh * 0.17; // leave room for hair
      const ts = Math.max(fw, fh * 0.82) * 2.25;
      const k = this.haveCrop ? 0.35 : 1; // smooth the crop so the head does not jitter
      this.cx += (tx - this.cx) * k;
      this.cy += (ty - this.cy) * k;
      this.size += (ts - this.size) * (this.haveCrop ? 0.2 : 1);
      this.haveCrop = true;
      this.lastFaceAt = now;
    }
    const tracking = this.haveCrop && now - this.lastFaceAt < 1200;
    if (tracking !== this.hasFace) {
      this.hasFace = tracking;
      this.setStatus(tracking ? 'live' : 'searching');
    }
    if (!this.haveCrop) return;

    // 1) Square head crop, clipped by hand so partially off-screen heads behave on every browser.
    const size = this.size;
    const sx = this.cx - size / 2;
    const sy = this.cy - size / 2;
    const ix = Math.max(0, sx), iy = Math.max(0, sy);
    const iw = Math.min(vw, sx + size) - ix;
    const ih = Math.min(vh, sy + size) - iy;
    const scale = CUT / size;
    this.cropCtx.clearRect(0, 0, CUT, CUT);
    if (iw > 2 && ih > 2) this.cropCtx.drawImage(v, ix, iy, iw, ih, (ix - sx) * scale, (iy - sy) * scale, iw * scale, ih * scale);

    // 2) Head-region matte from landmarks (kept from the last sighting if tracking blinks).
    const useSeg = this.mode === 'segment' && !!models.segmenter;
    if (found) this.drawRegion(found, vw, vh, sx, sy, size, useSeg);

    // 3) Person segmentation on the crop, multiplied by the head region.
    const m = this.matteCtx;
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, CUT, CUT);
    let segmented = false;
    if (useSeg && tracking) {
      try {
        models.segmenter!.segmentForVideo(this.crop, now, (result) => {
          const masks = result.confidenceMasks;
          if (!masks || !masks.length) return;
          segmented = this.drawPerson(masks);
        });
      } catch (e) {
        console.warn('[face] segmentation failed for this frame', e);
      }
    }
    if (useSeg && tracking) {
      if (segmented) {
        this.personValid = true;
        this.segFailures = 0;
      } else if (++this.segFailures > 20) {
        // Segmentation is not working on this device: fall back to the landmark matte for good.
        this.mode = 'lite';
        this.personValid = false;
      }
    }
    // If one frame of segmentation fails, reuse the previous person mask rather than flashing background.
    const havePerson = useSeg && this.personValid;
    if (tracking && (havePerson || !useSeg)) {
      if (havePerson) {
        m.drawImage(this.person, 0, 0, CUT, CUT);
        m.globalCompositeOperation = 'destination-in';
      }
      m.imageSmoothingEnabled = true;
      m.drawImage(this.region, 0, 0, CUT, CUT);
      m.globalCompositeOperation = 'source-over';
    }
    this.activeMode = havePerson ? 'segment' : 'lite';

    // 4) Pack colour and matte side by side.
    const o = this.out;
    o.fillStyle = '#000';
    o.fillRect(0, 0, PACKED_W, PACKED_H);
    o.drawImage(this.crop, 0, 0);
    o.drawImage(this.matte, CUT, 0);
  }

  /** Writes the person-probability mask into `this.person` as white-with-alpha. */
  private drawPerson(masks: { width: number; height: number; getAsFloat32Array(): Float32Array }[]): boolean {
    const w = masks[0].width;
    const h = masks[0].height;
    if (!w || !h) return false;
    // Different builds of the selfie model order/invert their output differently,
    // so calibrate against a pixel we know is on the face: the crop centre.
    const centre = Math.floor(h * 0.56) * w + Math.floor(w / 2);
    let data = masks[0].getAsFloat32Array();
    let invert = false;
    if (data[centre] < 0.5) {
      if (masks.length > 1) {
        const alt = masks[1].getAsFloat32Array();
        if (alt[centre] >= 0.5) data = alt;
        else return false;
      } else {
        invert = true;
      }
    }
    if (this.person.width !== w || this.person.height !== h) {
      this.person.width = w;
      this.person.height = h;
      this.personData = null;
    }
    if (!this.personData) {
      this.personData = this.personCtx.createImageData(w, h);
      this.personData.data.fill(255);
    }
    const px = this.personData.data;
    for (let i = 0, n = w * h; i < n; i++) {
      let a = invert ? 1 - data[i] : data[i];
      a = (a - 0.3) * 2.5; // tighten the soft edge
      px[i * 4 + 3] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255) | 0;
    }
    this.personCtx.putImageData(this.personData, 0, 0);
    return true;
  }

  /** Low-res, naturally feathered polygon of the area that counts as "head". */
  private drawRegion(lm: { x: number; y: number }[], vw: number, vh: number, sx: number, sy: number, size: number, withSegmentation: boolean) {
    const R = this.region.width;
    const g = this.regionCtx;
    const pt = (i: number) => ({ x: ((lm[i].x * vw - sx) / size) * R, y: ((lm[i].y * vh - sy) / size) * R });
    const ring = OVAL.map(pt);
    let cx = 0, cy = 0;
    for (const p of ring) {
      cx += p.x;
      cy += p.y;
    }
    cx /= ring.length;
    cy /= ring.length;
    const grow = (p: { x: number; y: number }, k: number) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k });

    g.clearRect(0, 0, R, R);
    g.fillStyle = '#fff';
    g.beginPath();
    if (withSegmentation) {
      // Everything above the jawline is allowed through (hair, ears, hats);
      // the segmenter decides what is actually person. Below the jaw is cut.
      const right = grow(ring[JAW_FROM], 1.12);
      const left = grow(ring[JAW_TO], 1.12);
      g.moveTo(-8, -8);
      g.lineTo(R + 8, -8);
      g.lineTo(R + 8, right.y);
      for (let i = JAW_FROM; i <= JAW_TO; i++) {
        const p = grow(ring[i], 1.07);
        g.lineTo(p.x, p.y);
      }
      g.lineTo(-8, left.y);
    } else {
      // Lite matte: the face oval itself, widened and raised over the forehead.
      ring.forEach((p, i) => {
        const q = grow(p, 1.16);
        if (p.y < cy) q.y -= (cy - p.y) * 0.32;
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
    }
    g.closePath();
    g.fill();
  }
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}
