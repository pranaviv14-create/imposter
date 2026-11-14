// Copies the MediaPipe WASM runtime into /public so the app serves it itself,
// and (with --models) downloads the two small model files so nothing is fetched
// from a third-party CDN at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = path.join(root, 'public', 'mediapipe', 'wasm');

if (fs.existsSync(wasmSrc)) {
  fs.mkdirSync(wasmDst, { recursive: true });
  for (const f of fs.readdirSync(wasmSrc)) fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));
  console.log('[setup] MediaPipe WASM runtime copied to public/mediapipe/wasm');
} else {
  console.log('[setup] @mediapipe/tasks-vision not installed yet — skipping WASM copy');
}

if (process.argv.includes('--models')) {
  const models = {
    'face_landmarker.task':
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
    'selfie_segmenter.tflite':
      'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  };
  const dst = path.join(root, 'public', 'models');
  fs.mkdirSync(dst, { recursive: true });
  for (const [name, url] of Object.entries(models)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      fs.writeFileSync(path.join(dst, name), Buffer.from(await res.arrayBuffer()));
      console.log('[setup] downloaded', name);
    } catch (e) {
      console.warn('[setup] could not download', name, '-', e.message, '(the app will fall back to the CDN)');
    }
  }
}
