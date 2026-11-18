// One-time setup for the optional voice companion: a private Python environment
// in voice-server/.venv plus the speech model in voice-server/models. Nothing is
// installed outside this project.
//
//   npm run voice:setup
//
// VOICE_PYTHON  Python 3.10+ to build the environment from (default: first found)
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'voice-server');
export const venvPython = join(dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const modelsDir = join(dir, 'models');

const RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const FILES = [
  { name: 'kokoro-v1.0.onnx', minBytes: 200e6 },
  { name: 'voices-v1.0.bin', minBytes: 10e6 },
];

export const isReady = () =>
  existsSync(venvPython)
  && spawnSync(venvPython, ['-c', 'import kokoro_onnx'], { stdio: 'ignore' }).status === 0
  && FILES.every((f) => existsSync(join(modelsDir, f.name)) && statSync(join(modelsDir, f.name)).size > f.minBytes);

function pythons() {
  const candidates = [process.env.VOICE_PYTHON, 'python3.12', 'python3.11', 'python3.13', 'python3.10', 'python3', '/opt/anaconda3/bin/python', 'python'].filter(Boolean);
  const ok = 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)';
  return candidates.filter((py) => spawnSync(py, ['-c', ok], { stdio: 'ignore' }).status === 0);
}

/** Try each suitable interpreter until one can build a working environment (some lack ensurepip). */
function createVenv() {
  for (const python of pythons()) {
    console.log(`[voice] creating voice-server/.venv with ${python}`);
    rmSync(join(dir, '.venv'), { recursive: true, force: true });
    if (spawnSync(python, ['-m', 'venv', join(dir, '.venv')], { stdio: 'ignore' }).status === 0) return true;
  }
  rmSync(join(dir, '.venv'), { recursive: true, force: true });
  return false;
}

async function download({ name, minBytes }) {
  const target = join(modelsDir, name);
  if (existsSync(target) && statSync(target).size > minBytes) return;
  console.log(`[voice] downloading ${name} …`);
  const res = await fetch(`${RELEASE}/${name}`, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`);
  const part = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  if (statSync(part).size < minBytes) throw new Error(`${name}: download incomplete`);
  renameSync(part, target);
}

export async function setup() {
  if (!existsSync(venvPython) || spawnSync(venvPython, ['-m', 'pip', '--version'], { stdio: 'ignore' }).status !== 0) {
    if (!createVenv()) throw new Error('could not create a Python environment. Set VOICE_PYTHON to a Python 3.10–3.13 that has venv and pip.');
  }
  console.log('[voice] installing speech packages (first time only) …');
  const pip = spawnSync(venvPython, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', join(dir, 'requirements.txt')], { stdio: 'inherit' });
  if (pip.status !== 0) throw new Error('pip install failed');
  mkdirSync(modelsDir, { recursive: true });
  for (const file of FILES) await download(file);
  console.log('[voice] setup complete');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setup().catch((err) => {
    console.error(`[voice] setup failed: ${err.message}`);
    process.exit(1);
  });
}
