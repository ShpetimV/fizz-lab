import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Version of the installed MediaPipe package, used for the CDN fallback URL so
// the wasm runtime always matches the bundled JS.
const mpVersion = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
).version;

export default defineConfig({
  base: './',
  define: {
    __MP_VERSION__: JSON.stringify(mpVersion),
  },
  server: { host: 'localhost', port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
