// Every sound is synthesised live with the Web Audio API; there are no audio files.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.hum = null;
    this.charge = null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);

    // shared white-noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // --- continuous hum while an atom is held: two detuned saws through a low-pass, slow tremolo
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 320;
    humFilter.Q.value = 4;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    o1.frequency.value = 55;
    o2.frequency.value = 82.9;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(humFilter.frequency);
    o1.connect(humFilter);
    o2.connect(humFilter);
    humFilter.connect(humGain).connect(this.master);
    o1.start();
    o2.start();
    lfo.start();
    this.hum = { gain: humGain, filter: humFilter, o1, o2 };

    // --- continuous charge tone that rises as the pinch closes
    const chGain = ctx.createGain();
    chGain.gain.value = 0;
    const ch = ctx.createOscillator();
    ch.type = 'triangle';
    ch.frequency.value = 300;
    const ch2 = ctx.createOscillator();
    ch2.type = 'sine';
    ch2.frequency.value = 603;
    ch.connect(chGain);
    ch2.connect(chGain);
    chGain.connect(this.master);
    ch.start();
    ch2.start();
    this.charge = { gain: chGain, o: ch, o2: ch2 };
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  get ok() {
    return !!this.ctx && !this.muted && this.ctx.state === 'running';
  }

  // ---- building blocks ----------------------------------------------------
  tone({ type = 'sine', f0, f1 = f0, dur = 0.2, gain = 0.2, attack = 0.005, delay = 0, curve = 'exp' }) {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.3, gain = 0.2, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.01, delay = 0 }) {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ---- continuous controls (call every frame) -----------------------------
  /** @param level 0..1 how strongly something is being held; @param lift 0..1 raises the pitch (depth) */
  setHum(level, lift = 0.5) {
    if (!this.ctx || !this.hum) return;
    const t = this.ctx.currentTime;
    this.hum.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.16, t, 0.08);
    this.hum.o1.frequency.setTargetAtTime(48 + lift * 22, t, 0.1);
    this.hum.o2.frequency.setTargetAtTime((48 + lift * 22) * 1.505, t, 0.1);
  }

  /** @param level 0..1 pinch closure of a hand that is not yet gripping */
  setCharge(level) {
    if (!this.ctx || !this.charge) return;
    const t = this.ctx.currentTime;
    this.charge.gain.gain.setTargetAtTime(this.muted ? 0 : level * level * 0.035, t, 0.04);
    this.charge.o.frequency.setTargetAtTime(240 + level * 900, t, 0.03);
    this.charge.o2.frequency.setTargetAtTime(483 + level * 1810, t, 0.03);
  }

  // ---- one-shots -----------------------------------------------------------
  pinch() {
    this.tone({ type: 'triangle', f0: 520, f1: 1500, dur: 0.11, gain: 0.09 });
  }

  release() {
    this.tone({ type: 'sine', f0: 900, f1: 360, dur: 0.14, gain: 0.06 });
  }

  spawn() {
    this.noise({ dur: 0.5, gain: 0.1, f0: 500, f1: 5200, q: 2.5, attack: 0.3 });
    this.tone({ f0: 330, f1: 990, dur: 0.48, gain: 0.07, attack: 0.3 });
    this.tone({ type: 'triangle', f0: 1320, dur: 0.5, gain: 0.08, delay: 0.42 });
    this.tone({ f0: 1980, dur: 0.7, gain: 0.04, delay: 0.42 });
  }

  /** Electrical crackle while the lightning arc builds. */
  crackle(dur = 0.36) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const d = (i / n) * dur + Math.random() * 0.015;
      this.noise({ dur: 0.012 + Math.random() * 0.03, gain: 0.1 + (i / n) * 0.2, type: 'highpass', f0: 1800 + Math.random() * 3000, q: 0.7, attack: 0.001, delay: d });
    }
    this.tone({ type: 'sawtooth', f0: 90, f1: 420, dur, gain: 0.04, attack: dur * 0.8, curve: 'lin' });
  }

  /** The bond snaps shut: higher bond order = brighter chord. */
  snap(order = 1) {
    this.noise({ dur: 0.07, gain: 0.25, type: 'highpass', f0: 3000, attack: 0.001 });
    this.tone({ type: 'triangle', f0: 180, f1: 60, dur: 0.22, gain: 0.3, attack: 0.002 });
    const base = 660;
    [1, 1.5, 2].slice(0, order).forEach((m, i) => this.tone({ f0: base * m, dur: 0.5, gain: 0.09, delay: i * 0.035 }));
  }

  /** Ionic transfer: a zap as the electron crosses. */
  zap() {
    this.tone({ type: 'sawtooth', f0: 2400, f1: 180, dur: 0.32, gain: 0.1 });
    this.noise({ dur: 0.25, gain: 0.12, type: 'highpass', f0: 2500, attack: 0.002 });
    this.tone({ f0: 440, dur: 0.9, gain: 0.07, delay: 0.5 });
    this.tone({ f0: 554, dur: 0.9, gain: 0.06, delay: 0.5 });
  }

  /** Molecule complete: deep boom, air thump, slow major shimmer. */
  boom() {
    this.tone({ f0: 110, f1: 28, dur: 1.5, gain: 0.85, attack: 0.004 });
    this.tone({ type: 'triangle', f0: 55, f1: 36, dur: 1.1, gain: 0.35, attack: 0.004 });
    this.noise({ dur: 0.7, gain: 0.4, type: 'lowpass', f0: 900, f1: 60, attack: 0.004 });
    this.noise({ dur: 1.4, gain: 0.07, f0: 6000, f1: 900, q: 1.2, attack: 0.02, delay: 0.05 });
    [523.25, 659.25, 783.99, 1046.5, 1568].forEach((f, i) => {
      this.tone({ f0: f, dur: 2.4, gain: 0.05, attack: 0.25, delay: 0.12 + i * 0.07 });
    });
  }

  whoosh() {
    this.noise({ dur: 0.55, gain: 0.3, f0: 300, f1: 4200, q: 1.4, attack: 0.18 });
    this.noise({ dur: 0.5, gain: 0.16, f0: 3600, f1: 240, q: 1.2, attack: 0.02, delay: 0.3 });
    this.tone({ f0: 700, f1: 120, dur: 0.5, gain: 0.07, delay: 0.1 });
  }

  reject() {
    this.tone({ type: 'square', f0: 110, dur: 0.3, gain: 0.11, attack: 0.002 });
    this.tone({ type: 'square', f0: 116.5, dur: 0.3, gain: 0.11, attack: 0.002 });
    this.tone({ type: 'sawtooth', f0: 480, f1: 90, dur: 0.24, gain: 0.07 });
    this.noise({ dur: 0.1, gain: 0.14, type: 'highpass', f0: 2000, attack: 0.001 });
  }

  blip(f = 1200) {
    this.tone({ type: 'triangle', f0: f, dur: 0.07, gain: 0.05, attack: 0.002 });
  }

  discover() {
    [880, 1108.7, 1318.5, 1760].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.06, delay: 0.9 + i * 0.07 }));
  }

  // ---- liquid metal + bubbles ---------------------------------------------
  /** Two droplets flow together: a wet "plip" whose pitch drops with size. */
  plip(size = 0.5) {
    const f = 900 / Math.max(0.35, size);
    this.tone({ f0: f, f1: f * 2.2, dur: 0.09, gain: 0.12, attack: 0.002 });
    this.tone({ f0: f * 0.5, f1: f * 0.35, dur: 0.16, gain: 0.08, attack: 0.002, delay: 0.02 });
    this.noise({ dur: 0.05, gain: 0.05, type: 'lowpass', f0: 1800, attack: 0.002 });
  }

  /** A droplet pinches off: a stretchy rising squelch. */
  tear(size = 0.5) {
    this.noise({ dur: 0.22, gain: 0.12, f0: 300, f1: 2200, q: 4, attack: 0.03 });
    this.tone({ f0: 260 / Math.max(0.35, size), f1: 1300, dur: 0.16, gain: 0.08, attack: 0.01, delay: 0.06 });
  }

  /** The whole blob is splashed apart. */
  splash() {
    this.noise({ dur: 0.45, gain: 0.3, type: 'lowpass', f0: 2600, f1: 400, attack: 0.004 });
    for (let i = 0; i < 6; i++) this.plip(0.25 + Math.random() * 0.4);
  }

  /** Changing the liquid: a glassy sweep. */
  swish() {
    this.noise({ dur: 0.6, gain: 0.12, f0: 500, f1: 6000, q: 3, attack: 0.25 });
    [1046.5, 1318.5, 1568].forEach((f, i) => this.tone({ f0: f, dur: 0.6, gain: 0.035, attack: 0.05, delay: 0.18 + i * 0.05 }));
  }

  /** Pouring in: a run of small plips. */
  pour(count = 10, every = 0.055) {
    for (let i = 0; i < count; i++) this.tone({ f0: 500 + Math.random() * 500, f1: 1200 + Math.random() * 600, dur: 0.06, gain: 0.05, attack: 0.002, delay: 0.1 + i * every });
  }

  /** A soap bubble bursts: a tiny, bright click with a puff of air. */
  pop(size = 0.4) {
    this.noise({ dur: 0.035, gain: 0.22, type: 'highpass', f0: 2500 + 2500 * (1 - Math.min(1, size)), attack: 0.001 });
    this.tone({ f0: 1400 / Math.max(0.3, size), f1: 300, dur: 0.05, gain: 0.05, attack: 0.001 });
  }

  /** A new bubble leaves the wand. */
  blow(size = 0.4) {
    this.noise({ dur: 0.18, gain: 0.04, f0: 600, f1: 1400, q: 1, attack: 0.05 });
    this.tone({ f0: 300 / Math.max(0.3, size), f1: 700 / Math.max(0.3, size), dur: 0.14, gain: 0.03, attack: 0.03 });
  }

  /** Phase change stingers. */
  phase(kind) {
    if (kind === 'ICE') {
      [2093, 1568, 1318.5, 1046.5, 2637].forEach((f, i) => this.tone({ f0: f, dur: 1.4, gain: 0.05, delay: i * 0.09 }));
      this.noise({ dur: 1.2, gain: 0.05, type: 'highpass', f0: 7000, attack: 0.3 });
    } else if (kind === 'GAS') {
      this.noise({ dur: 1.8, gain: 0.16, f0: 800, f1: 7000, q: 0.8, attack: 0.8 });
      this.tone({ type: 'sawtooth', f0: 80, f1: 320, dur: 1.4, gain: 0.05, attack: 0.7 });
    } else {
      for (let i = 0; i < 7; i++) this.tone({ f0: 300 + Math.random() * 500, f1: 700 + Math.random() * 900, dur: 0.09, gain: 0.07, delay: i * 0.08 + Math.random() * 0.04 });
      this.noise({ dur: 0.9, gain: 0.07, type: 'lowpass', f0: 1200, f1: 300, attack: 0.1 });
    }
  }
}
