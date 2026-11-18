// Copies the MediaPipe WASM runtime out of node_modules and downloads the two
// landmark models into public/mediapipe so the app runs fully offline.
// Safe to re-run; skips anything already present. If the download fails the
// app falls back to loading the same files from the public CDN at runtime.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'mediapipe');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');

const MODELS = {
  'hand_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

async function main() {
  await mkdir(join(outDir, 'models'), { recursive: true });

  if (existsSync(wasmSrc)) {
    await cp(wasmSrc, join(outDir, 'wasm'), { recursive: true });
    console.log('[assets] wasm runtime copied');
  } else {
    console.warn('[assets] @mediapipe/tasks-vision not installed yet, skipping wasm copy');
  }

  for (const [name, url] of Object.entries(MODELS)) {
    const dest = join(outDir, 'models', name);
    if (existsSync(dest) && (await stat(dest)).size > 100_000) {
      console.log(`[assets] ${name} already present`);
      continue;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`[assets] downloaded ${name}`);
    } catch (err) {
      console.warn(`[assets] could not download ${name} (${err.message}); the app will use the CDN copy`);
    }
  }
}

main().catch((err) => {
  console.warn('[assets] setup skipped:', err.message);
});
