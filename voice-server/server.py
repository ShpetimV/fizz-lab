#!/usr/bin/env python
"""Fizz voice companion: a local LLM that reacts to the lab, spoken live.

Three local pieces, nothing leaves the machine (it listens on 127.0.0.1 only):
  * the brain  - a model served by Ollama writes each remark
  * the voice  - Kokoro (ONNX, CPU) speaks it in a natural female voice
  * the ears   - faster-whisper transcribes spoken questions

Start it with `npm run voice` (which sets up and uses voice-server/.venv), or directly:

    voice-server/.venv/bin/python voice-server/server.py

Endpoints (responses to POSTs are newline-delimited JSON, streamed):
    GET  /health            {"ok", "llm", "model", "persona", "voice", "ears"}
    POST /react   JSON      {"event", "facts", "must", "state", "fallback", "priority"}
    POST /say     JSON      {"text"}                       speak a fixed line
    POST /ask     JSON      {"audio" (base64), "mime", "context"}   spoken question
                            {"question", "context"}                 typed question
Stream events: {"type": "heard" | "text" | "audio" | "error" | "done", ...}
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PERSONA = "Vera"

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("--port", type=int, default=8765)
parser.add_argument("--model", default=os.environ.get("VOICE_MODEL", "dolphin-llama3:8b"), help="Ollama model that writes the remarks")
parser.add_argument("--ollama", default=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"), help="Ollama base URL")
parser.add_argument("--voice", default=os.environ.get("VOICE_NAME", "af_heart"), help="Kokoro voice, e.g. af_heart, af_bella, bf_emma")
parser.add_argument("--speed", type=float, default=float(os.environ.get("VOICE_SPEED", "0.97")))
parser.add_argument("--models-dir", default=str(HERE / "models"), help="folder with kokoro-v1.0.onnx and voices-v1.0.bin")
parser.add_argument("--no-llm", action="store_true", help="voice only: speak the lab's built-in lines")
parser.add_argument("--samples", action="store_true", help="write a short sample of every English female voice to voice-server/samples and exit")
args = parser.parse_args()

OLLAMA_BASE = args.ollama.rstrip("/")
OLLAMA_CHAT = f"{OLLAMA_BASE}/api/chat"
MODEL = args.model

SYSTEM_PROMPT = f"""You are {PERSONA}, the resident artificial intelligence of Fizz, a hands-on science \
playground. With their bare hands, a human builds molecules from six elements (hydrogen, carbon, \
nitrogen, oxygen, sodium, chlorine), plays with liquid metals (mercury, gallium, ferrofluid, molten \
gold), blows and pops soap bubbles, and heats and cools water. You watch and comment.

Personality: dry, deadpan, quick, impeccably polite. You tease the human like a brilliant lab \
partner who is faintly unimpressed and would never admit to enjoying this. Never cruel, never gushing.

Each message is an EVENT (something the human just did) or a QUESTION from them. It may include \
FACTS, LAB STATE, REFERENCE, and a MUST SAY line.

Rules, in order of importance:
1. The science must be correct. Every chemical statement you make must be taken from the FACTS or \
REFERENCE you were given. Never invent numbers, angles, properties or uses. Never name a molecule \
or element that does not appear in the message. With no FACTS, make no scientific claim; just react.
2. When FACTS are given, teach: state the key fact (for a finished molecule, its shape or bond \
angle and the reason) in your own words, then add one dry remark.
3. If there is a MUST SAY line, your reply has to get that information across.
4. If a QUESTION is not covered by FACTS or REFERENCE, say you will not speculate. Do not guess.
5. Be brief: at most two short sentences for an EVENT, at most three for a QUESTION.
6. This is read aloud: plain prose only. No markdown, lists, emoji, asterisks, stage directions or \
quotation marks. Use molecule names rather than formulas. Never mention being a language model."""

# A few worked examples steer a small local model far better than rules alone.
EXAMPLES = [
    ("EVENT: The player completed a molecule for the first time: Methane. Progress: 2 of 18.\n"
     "FACTS: Shape: tetrahedral. Bond angle: 109.5 degrees. Four bonding pairs and no lone pairs spread out evenly in three dimensions.",
     "Methane. Four bonding pairs and no lone pairs, so they spread into a perfect tetrahedron at 109.5 degrees. "
     "Five atoms in the right order. I have filed it under small miracles."),
    ("EVENT: A bond was refused. The player pushed a chlorine atom against a finished methane molecule.\n"
     "FACTS: Carbon forms exactly four bonds and already has four, so its valence is full.",
     "No. Carbon forms four bonds and it already has four. The atom understood that immediately, which is encouraging for one of you."),
    ("EVENT: The player smashed a molecule back into 3 separate atoms.\n"
     "FACTS: Breaking bonds does not destroy atoms; matter is conserved.",
     "You broke it. The atoms are all still there, of course. Matter is conserved, unlike my patience."),
    ("EVENT: The player opened the water lab.\nMUST SAY: scroll to change the temperature.",
     "Forty water molecules, and one of you. Scroll to change the temperature, and do try to keep up with them."),
    ("EVENT: The player held an open hand over the mercury as if it were a magnet. Nothing magnetic happened.\n"
     "FACTS: Mercury is not magnetic, so a magnet does nothing to it. Of the liquids here only the ferrofluid responds to a magnet.",
     "Mercury is not magnetic, so your hand is just a hand. The ferrofluid is the one that will answer it."),
    ("EVENT: A soap bubble burst on its own after its film drained away.\n"
     "FACTS: Gravity drains the film downward, so it thins from the top. When the film gets much thinner than the "
     "wavelength of light, the two reflections cancel and the bubble is about to burst.",
     "It drained from the top until the film was too thin to show any colour, and then it was gone. "
     "Rather like your attention span, but prettier."),
]

busy = threading.Lock()  # one generation at a time
history: list[dict[str, str]] = []  # short rolling memory so remarks do not repeat
state = {"llm": False, "ears": False, "tts": False}
_whisper = None


# ---------------------------------------------------------------- brain
def ollama_up() -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_BASE}/api/tags", timeout=2) as resp:
            tags = json.loads(resp.read().decode("utf-8"))
        names = [m.get("name", "") for m in tags.get("models", [])]
        return any(n == MODEL or n.startswith(MODEL.split(":")[0]) for n in names)
    except (urllib.error.URLError, OSError, ValueError):
        return False


def ensure_ollama() -> bool:
    if args.no_llm:
        return False
    if ollama_up():
        return True
    exe = shutil.which("ollama")
    if not exe:
        return False
    print("[voice] Ollama is not running: starting `ollama serve`", flush=True)
    subprocess.Popen([exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(40):
        time.sleep(0.5)
        if ollama_up():
            return True
    return False


def clean(text: str, max_sentences: int) -> str:
    """Make the model's reply safe to read aloud and keep it to the requested length."""
    text = re.sub(r"\*[^*]*\*", " ", text)  # stage directions
    text = re.sub(r"[`#*_>\[\]{}|~^]", " ", text)
    text = re.sub(r"[\U0001F000-\U0001FAFF☀-➿]", "", text)  # emoji / dingbats
    text = text.replace("\n", " ").replace('"', "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(rf"^{PERSONA}\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    parts = split_sentences(text)
    return " ".join(parts[:max_sentences]).strip()


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", text) if p.strip()]
    return parts or ([text] if text else [])


SENTENCE_END = re.compile(r"(?<=[.!?])[\"')\]]*\s+(?=\S)")


def think(user_content: str, max_sentences: int):
    """Ask the local LLM for an in-character reply. Yields finished sentences as they are generated."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for q, a in EXAMPLES:
        messages += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
    messages += [*history[-6:], {"role": "user", "content": user_content}]
    payload = {
        "model": MODEL,
        "stream": True,
        "messages": messages,
        "keep_alive": "30m",
        "options": {"temperature": 0.55, "top_p": 0.9, "num_predict": 90, "repeat_penalty": 1.12},
    }
    req = urllib.request.Request(OLLAMA_CHAT, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
    spoken: list[str] = []
    buffer = ""
    with urllib.request.urlopen(req, timeout=60) as resp:
        for raw in resp:
            if not raw.strip():
                continue
            chunk = json.loads(raw.decode("utf-8"))
            buffer += chunk.get("message", {}).get("content", "")
            done = chunk.get("done", False)
            while len(spoken) < max_sentences:
                m = SENTENCE_END.search(buffer)
                if not m and not done:
                    break
                piece, buffer = (buffer[: m.start()], buffer[m.end():]) if m else (buffer, "")
                sentence = clean(piece, 1)
                if len(sentence) > 1:
                    spoken.append(sentence)
                    yield sentence
                if not m:
                    break
            if done or len(spoken) >= max_sentences:
                break  # closing the connection stops generation
    if spoken:
        # remember only a one-line gist of the prompt, so facts blocks do not pile up in context
        history.append({"role": "user", "content": user_content.split("\n")[0][:240]})
        history.append({"role": "assistant", "content": " ".join(spoken)})
        del history[:-12]


# ---------------------------------------------------------------- voice
def speakable(text: str) -> str:
    for a, b in (("’", "'"), ("‘", "'"), ("“", ""), ("”", ""), ("—", ", "), ("–", "-"), ("…", "..."), ("°", " degrees")):
        text = text.replace(a, b)
    subs = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
    return text.translate(subs)


_kokoro = None


def load_voice():
    """Kokoro on the CPU, capped at four threads so rendering and hand tracking keep their cores."""
    global _kokoro
    if _kokoro is None:
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        models = Path(args.models_dir)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        session = ort.InferenceSession(str(models / "kokoro-v1.0.onnx"), sess_options=opts, providers=["CPUExecutionProvider"])
        _kokoro = Kokoro.from_session(session, str(models / "voices-v1.0.bin"))
        if args.voice not in _kokoro.get_voices():
            raise SystemExit(f"[voice] unknown voice '{args.voice}'. Try one of: {', '.join(female_voices(_kokoro))}")
    return _kokoro


def female_voices(kokoro) -> list[str]:
    return [v for v in kokoro.get_voices() if v[:2] in ("af", "bf")]


def to_wav(audio: np.ndarray, sr: int) -> tuple[bytes, float]:
    audio = np.clip(np.asarray(audio, dtype=np.float32), -1, 1)
    peak = max(1e-4, float(np.abs(audio).max()))
    pcm = (audio * (32767 * 0.85 / peak)).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm.tobytes())
    return buf.getvalue(), len(pcm) / float(sr)


def synthesize(text: str, voice: str | None = None) -> tuple[bytes, float]:
    """Text -> WAV bytes."""
    voice = voice or args.voice
    lang = "en-gb" if voice.startswith("b") else "en-us"
    audio, sr = load_voice().create(speakable(text), voice=voice, speed=args.speed, lang=lang)
    return to_wav(audio, sr)


def transcribe(audio_bytes: bytes, suffix: str) -> str:
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        # base.en with int8 on the CPU: short questions transcribe in a second or two
        _whisper = WhisperModel("base.en", device="cpu", compute_type="int8")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        path = tmp.name
    try:
        segments, _ = _whisper.transcribe(path, language="en")
        return "".join(seg.text for seg in segments).strip()
    finally:
        os.unlink(path)


def write_samples():
    """One clip per English female voice, so a voice can be chosen by ear."""
    out = HERE / "samples"
    out.mkdir(exist_ok=True)
    line = "Water. Two bonds and two lone pairs, bent to 104.5 degrees. You built it correctly, which I had not planned for."
    for voice in female_voices(load_voice()):
        wav, seconds = synthesize(line, voice)
        (out / f"{voice}.wav").write_bytes(wav)
        print(f"[voice] {out / (voice + '.wav')}  ({seconds:.1f}s)", flush=True)
    print(f"[voice] listen, then start with:  npm run voice -- --voice <name>", flush=True)


# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "FizzVoice/2.0"

    def log_message(self, fmt, *a):  # quiet access log
        return

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def json(self, code: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            self.json(200, {"ok": state["tts"], "llm": state["llm"], "model": MODEL if state["llm"] else None,
                            "persona": PERSONA, "voice": args.voice, "ears": state["ears"], "busy": busy.locked()})
        else:
            self.json(404, {"error": "not found"})

    def emit(self, obj: dict):
        self.wfile.write((json.dumps(obj) + "\n").encode("utf-8"))
        self.wfile.flush()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        route = self.path.split("?")[0]
        if route not in ("/react", "/say", "/ask"):
            return self.json(404, {"error": "not found"})
        ctype = self.headers.get("Content-Type", "")
        data = {}
        if "application/json" in ctype:
            try:
                data = json.loads(body.decode("utf-8") or "{}")
            except ValueError:
                return self.json(400, {"error": "bad json"})
        # low-priority chatter is dropped while she is still talking
        priority = route != "/react" or bool(data.get("priority"))
        if not busy.acquire(blocking=priority, timeout=20 if priority else -1):
            return self.json(429, {"busy": True})
        try:
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.handle_stream(route, data, body, ctype)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page moved on
        except Exception as err:  # keep the server alive whatever happens
            print(f"[voice] error: {err!r}", flush=True)
            try:
                self.emit({"type": "error", "message": str(err)})
            except OSError:
                pass
        finally:
            busy.release()

    def handle_stream(self, route: str, data: dict, body: bytes, ctype: str):
        t0 = time.time()
        if route == "/say":
            sentences = iter(split_sentences(str(data.get("text", "")).strip()))
        elif route == "/react":
            if data.get("reset"):
                history.clear()
            prompt = f"EVENT: {data.get('event', '')}"
            if data.get("facts"):
                prompt += f"\nFACTS: {data['facts']}"
            if data.get("state"):
                prompt += f"\nLAB STATE: {data['state']}"
            if data.get("must"):
                prompt += f"\nMUST SAY: {data['must']}"
            sentences = self.generate(prompt, 2, str(data.get("fallback", "")).strip())
        else:  # /ask
            context = data.get("context") or {}
            question = str(data.get("question", "")).strip()
            if not question and data.get("audio"):
                mime = str(data.get("mime", ""))
                suffix = ".webm" if "webm" in mime else ".mp4" if "mp4" in mime else ".wav" if "wav" in mime else ".ogg"
                question = transcribe(base64.b64decode(data["audio"]), suffix)
            self.emit({"type": "heard", "text": question})
            if not question:
                sentences = iter(["I heard nothing. Do try speaking toward the microphone."])
            else:
                prompt = f"QUESTION from the player: {question}"
                if context.get("state"):
                    prompt += f"\nLAB STATE: {context['state']}"
                if context.get("reference"):
                    prompt += f"\nREFERENCE: {context['reference']}"
                sentences = self.generate(prompt, 3, "My reasoning is offline at the moment, so that question will have to wait.")
        # speak sentence by sentence: the first words start while the rest is still being written
        for sentence in sentences:
            self.emit({"type": "text", "text": sentence, "ms": int((time.time() - t0) * 1000)})
            t2 = time.time()
            wav, seconds = synthesize(sentence)
            self.emit({"type": "audio", "wav": base64.b64encode(wav).decode("ascii"), "seconds": round(seconds, 2),
                       "ms": int((time.time() - t2) * 1000)})
        self.emit({"type": "done", "ms": int((time.time() - t0) * 1000)})

    def generate(self, prompt: str, max_sentences: int, fallback: str):
        """Sentences from the LLM; if it is unavailable or says nothing, the lab's own line instead."""
        said = False
        if state["llm"]:
            try:
                for sentence in think(prompt, max_sentences):
                    said = True
                    yield sentence
            except (urllib.error.URLError, OSError, KeyError, ValueError) as err:
                print(f"[voice] LLM unavailable ({err!r}); using the built-in line", flush=True)
                state["llm"] = ollama_up()
        if not said:
            yield from split_sentences(fallback)


def main():
    if args.samples:
        return write_samples()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[voice] listening on http://127.0.0.1:{args.port} (loading models…)", flush=True)

    t0 = time.time()
    load_voice()
    synthesize("Ready.")  # warm the synthesiser so the first real line is fast
    state["tts"] = True
    print(f"[voice] {PERSONA}'s voice ready in {time.time() - t0:.0f}s ({args.voice})", flush=True)

    state["llm"] = ensure_ollama()
    if state["llm"]:
        t1 = time.time()
        try:
            list(think("EVENT: Systems check. Reply with two words.", 1))
            history.clear()
            print(f"[voice] brain ready: {MODEL} ({time.time() - t1:.0f}s to load)", flush=True)
        except (urllib.error.URLError, OSError, KeyError, ValueError) as err:
            state["llm"] = False
            print(f"[voice] brain failed to load: {err!r}", flush=True)
    else:
        print("[voice] no LLM (Ollama / model not available): speaking the lab's built-in lines only", flush=True)
    try:
        import faster_whisper  # noqa: F401

        state["ears"] = True
    except ImportError:
        print("[voice] faster-whisper not installed: spoken questions disabled", flush=True)
    print("[voice] ready. Open the lab; press Ctrl-C here to stop.", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\n[voice] bye", flush=True)


if __name__ == "__main__":
    main()
