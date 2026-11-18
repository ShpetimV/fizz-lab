// The lab's narrator.
//
// Two engines, chosen automatically:
//   live     – the optional local voice companion (`npm run voice`): a local LLM
//              writes each remark from the event + verified facts the lab sends
//              it, and a local neural voice speaks it, streamed sentence by
//              sentence. Also answers spoken questions.
//   browser  – the Web Speech API reading the lab's own built-in line. Used when
//              the companion is not running, so the app never depends on it.
// Lines never overlap, and every line is mirrored to the HUD as a subtitle.

const SERVER = import.meta.env.VITE_VOICE_URL || 'http://127.0.0.1:8765';
// Fallback voice when the companion is not running: the most natural female English voice installed.
const PREFERRED = ['Ava', 'Zoe', 'Allison', 'Samantha', 'Serena', 'Kate', 'Karen', 'Moira', 'Tessa', 'Google US English', 'Google UK English Female', 'Flo'];

export const PERSONA = 'Vera';

export class Narrator {
  /**
   * @param hooks.onLine(text, append)  subtitle text
   * @param hooks.onEnd()               finished speaking
   * @param hooks.onThinking(bool)      waiting for the LLM
   * @param hooks.onHeard(text)         transcript of a spoken question
   * @param hooks.onEngine(server)      companion came online / went away
   * @param hooks.audioOut()            -> { ctx, node } Web Audio destination for the live voice
   */
  constructor(hooks = {}) {
    this.hooks = { onLine() {}, onEnd() {}, onThinking() {}, onHeard() {}, onEngine() {}, audioOut: () => null, ...hooks };
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.queue = [];
    this.busy = false;
    this.muted = false;
    this.voice = null;
    this.lastRemark = -100;
    this.server = { ok: false, llm: false, ears: false, persona: PERSONA, model: null };
    this.generation = 0; // bumped on stop/mute to cancel whatever is in flight
    this._timer = null;
    this._source = null;
    this._abort = null;
    if (this.synth) {
      this.pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  get persona() {
    return this.server.ok ? this.server.persona : PERSONA;
  }

  // ---- companion discovery ------------------------------------------------
  watchServer() {
    const check = async () => {
      let next = { ok: false, llm: false, ears: false, persona: PERSONA, model: null };
      try {
        const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) next = { ...next, ...(await res.json()) };
      } catch {
        /* not running: stay on the browser voice */
      }
      const changed = next.ok !== this.server.ok || next.llm !== this.server.llm;
      this.server = next;
      if (changed) this.hooks.onEngine(next);
      setTimeout(check, next.ok ? 15000 : 5000);
    };
    check();
  }

  pickVoice() {
    const voices = this.synth.getVoices();
    if (!voices.length) return;
    const english = voices.filter((v) => /^en/i.test(v.lang));
    for (const name of PREFERRED) {
      // "Ava (Premium)" / "Ava (Enhanced)" sound far better than the compact download, so prefer them
      const hits = english.filter((v) => v.name === name || v.name.startsWith(`${name} `));
      const best = hits.find((v) => /premium/i.test(v.name)) || hits.find((v) => /enhanced/i.test(v.name)) || hits[0];
      if (best) {
        this.voice = best;
        return;
      }
    }
    this.voice = english[0] || voices[0];
  }

  // ---- public API ---------------------------------------------------------
  /**
   * Narrate something that happened.
   * @param item.event    what happened, in plain words (for the LLM)
   * @param item.facts    verified facts the reply may use
   * @param item.must     information the reply has to convey
   * @param item.canned   the lab's own line: spoken as-is when there is no LLM
   * @param item.priority jump the queue and drop stale chatter
   * @param item.key      replaces any queued item with the same key
   */
  narrate(item) {
    if (!item || (!item.canned && !item.event)) return;
    if (item.key) this.queue = this.queue.filter((q) => q.key !== item.key);
    if (item.priority) this.queue = this.queue.filter((q) => q.priority);
    if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 2);
    this.queue.push(item);
    this.pump();
  }

  /** Occasional aside: only if the narrator is idle and has not quipped recently. */
  remark(item, now, minGap = 9) {
    if (this.busy || this.queue.length || now - this.lastRemark < minGap) return false;
    this.lastRemark = now;
    this.narrate(item);
    return true;
  }

  /** Ask a question (recorded audio Blob or typed text). Needs the companion. */
  ask(question, context) {
    if (!this.server.ok) return false;
    this.stop();
    this.queue.push({ ask: question, context, priority: true, canned: '' });
    this.pump();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.stop();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Cancel everything queued, in flight or playing. */
  stop() {
    this.generation++;
    this.queue.length = 0;
    this._abort?.abort();
    try {
      this._source?.stop();
    } catch {
      /* already stopped */
    }
    this.synth?.cancel();
    clearTimeout(this._timer);
    if (this.busy) {
      this.busy = false;
      this.hooks.onThinking(false);
      this.hooks.onEnd();
    }
  }

  // ---- engine -------------------------------------------------------------
  pump() {
    if (this.busy || !this.queue.length) return;
    const item = this.queue.shift();
    this.busy = true;
    const gen = this.generation;
    const finish = () => {
      if (gen !== this.generation) return;
      this.busy = false;
      this.hooks.onEnd();
      setTimeout(() => this.pump(), 250);
    };
    if (this.server.ok && !this.muted) this.runLive(item, gen).then(finish);
    else this.runBrowser(item.canned, gen).then(finish);
  }

  async runLive(item, gen) {
    const hooks = this.hooks;
    let shown = '';
    let playing = Promise.resolve();
    hooks.onThinking(true);
    try {
      let route = '/react';
      let payload = { event: item.event || `Say this in your own words: ${item.canned}`, facts: item.facts, must: item.must, state: item.state, fallback: item.canned, priority: !!item.priority, reset: !!item.reset };
      if (item.ask !== undefined) {
        route = '/ask';
        payload = { context: item.context };
        if (typeof item.ask === 'string') payload.question = item.ask;
        else {
          payload.audio = await blobToBase64(item.ask);
          payload.mime = item.ask.type;
        }
      }
      this._abort = new AbortController();
      const res = await fetch(SERVER + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: this._abort.signal,
      });
      if (res.status === 429) return; // she is still busy with something more important
      if (!res.ok || !res.body) throw new Error(`voice server ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line || gen !== this.generation) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'heard') hooks.onHeard(msg.text);
          else if (msg.type === 'text') {
            hooks.onThinking(false);
            const append = shown.length > 0;
            shown += (append ? ' ' : '') + msg.text;
            // subtitles keep pace with the audio: each sentence appears as its clip starts
            const text = shown;
            playing = playing.then(() => gen === this.generation && hooks.onLine(text, append));
          } else if (msg.type === 'audio') {
            const wav = msg.wav;
            playing = playing.then(() => this.play(wav, gen));
          } else if (msg.type === 'error') throw new Error(msg.message);
        }
      }
      await playing;
    } catch (err) {
      if (gen !== this.generation) return;
      if (err.name !== 'AbortError') console.warn('[voice] companion request failed:', err.message);
      // nothing was said yet: fall back to the built-in line in the browser voice
      if (!shown && item.canned) {
        hooks.onThinking(false);
        await this.runBrowser(item.canned, gen);
      }
    } finally {
      if (gen === this.generation) hooks.onThinking(false);
    }
  }

  /** Play one WAV clip (base64) through the app's audio graph. */
  async play(b64, gen) {
    if (gen !== this.generation || this.muted) return;
    const out = this.hooks.audioOut();
    if (!out) return;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buffer = await out.ctx.decodeAudioData(bytes.buffer);
    if (gen !== this.generation || this.muted) return;
    await new Promise((resolve) => {
      const src = out.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = out.ctx.createGain();
      gain.gain.value = 1.5;
      src.connect(gain).connect(out.node);
      src.onended = resolve;
      this._source = src;
      src.start();
    });
  }

  /** Read a fixed line with the Web Speech API (or just show it when muted / unavailable). */
  runBrowser(text, gen) {
    return new Promise((resolve) => {
      if (!text) return resolve();
      this.hooks.onLine(text, false);
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(this._timer);
        resolve();
      };
      const readMs = 1400 + text.length * 62;
      if (this.muted || !this.synth || gen !== this.generation) {
        this._timer = setTimeout(done, readMs * 0.8);
        return;
      }
      try {
        const u = new SpeechSynthesisUtterance(text);
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang || 'en-US';
        u.rate = 1.0;
        u.pitch = 1.0;
        u.volume = 0.95;
        u.onend = done;
        u.onerror = done;
        this._utterance = u; // keep a reference: Chrome may garbage-collect it mid-speech
        this.synth.speak(u);
        this._timer = setTimeout(done, readMs * 2.2 + 3000); // safety net if onend never fires
      } catch {
        this._timer = setTimeout(done, readMs * 0.8);
      }
    });
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
