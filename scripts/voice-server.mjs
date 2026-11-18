// Starts the optional local voice companion (LLM + natural voice + ears).
// See voice-server/server.py. The first run sets up voice-server/.venv and
// downloads the speech model (about 350 MB); after that it starts in seconds.
//
//   npm run voice                     start it
//   npm run voice -- --voice bf_emma  pick another voice
//   npm run voice -- --no-llm         voice only, built-in lines
//   npm run voice:samples             write a clip of every voice to voice-server/samples
//
// Environment overrides:
//   VOICE_PORT    default 8765
//   VOICE_MODEL   Ollama model name (default dolphin-llama3:8b)
//   VOICE_NAME    Kokoro voice (default af_heart)
//   VOICE_PYTHON  Python 3.10+ used to build the environment on first run
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isReady, setup, venvPython } from './voice-setup.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!isReady()) {
  try {
    await setup();
  } catch (err) {
    console.error(`[voice] setup failed: ${err.message}`);
    process.exit(1);
  }
}
const argv = [join(root, 'voice-server', 'server.py'), '--port', process.env.VOICE_PORT || '8765', ...process.argv.slice(2)];
const child = spawn(venvPython, argv, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
