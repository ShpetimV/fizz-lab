// Soap bubbles. Pure module: no DOM, no Three.js.
//
// Each bubble's film starts some hundreds of nanometres thick and thins as it
// drains and evaporates; when the film is gone the bubble bursts. Bubbles sink
// slowly in still air (the film has weight), wobble on air currents, get pushed
// by a moving hand and burst when a fingertip touches them.
import { makeRng, clamp } from '../core/math.js';

export const BUBBLES = {
  MAX: 40,
  SINK: 0.07, // downward drift in still air (scene units / s²)
  DRAG: 1.1,
  MAX_R: 0.85,
  GROW: 0.38, // radius per second while being blown
  POP_NM: 12, // a film thinner than this cannot hold
};

export class BubbleSim {
  constructor({ seed = 3, bounds = { x: 6, yMin: -3.6, yMax: 3.2, z: 2.4 } } = {}) {
    this.rng = makeRng(seed);
    this.bounds = bounds;
    this.bubbles = [];
    this.time = 0;
    this.popped = 0;
    this.wind = []; // [{ p, v, r }] moving hands push the air
    this.pokers = []; // [{ p, r }] fingertips
    this.nextId = 1;
    this._events = []; // bursts since the last step (blow() can burst one too)
  }

  /** A new bubble. `held` bubbles grow in place until let go. */
  blow(p, { r = 0.12, v = [0, 0, 0], held = false } = {}) {
    if (this.bubbles.length >= BUBBLES.MAX) {
      // make room: the oldest one bursts
      const oldest = this.bubbles.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
      this.burst(oldest, 'crowded');
    }
    const b = {
      id: this.nextId++,
      p: [...p],
      v: [...v],
      r,
      held,
      age: 0,
      life: 7 + this.rng() * 9, // seconds until the film has drained away
      d0: 780 + this.rng() * 420, // starting film thickness at the top (nm)
      seed: this.rng() * 100,
      born: this.time,
    };
    this.bubbles.push(b);
    return b;
  }

  /** Film thickness at the top of the bubble (nm). Thinner at the top than the bottom. */
  thickness(b) {
    const left = Math.max(0, 1 - b.age / b.life);
    return b.d0 * Math.pow(left, 0.65);
  }

  release(b, v = [0, 0, 0]) {
    if (!b) return;
    b.held = false;
    for (let k = 0; k < 3; k++) b.v[k] = clamp(v[k] * 0.35, -3, 3);
    b.v[1] += 0.15;
  }

  /** Bubble whose surface p is touching or inside, nearest first. */
  at(p, slack = 0) {
    let best = null;
    let bd = Infinity;
    for (const b of this.bubbles) {
      const d = Math.hypot(b.p[0] - p[0], b.p[1] - p[1], b.p[2] - p[2]) - b.r;
      if (d < slack && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  burst(b, cause) {
    const i = this.bubbles.indexOf(b);
    if (i < 0) return null;
    this.bubbles.splice(i, 1);
    this.popped++;
    const e = { type: 'pop', p: [...b.p], r: b.r, cause, age: b.age };
    this._events.push(e);
    return e;
  }

  /** Advance; returns [{ type: 'pop', p, r, cause: 'thin' | 'touch' | 'crowded', age }]. */
  step(dt) {
    this.time += dt;
    const drag = Math.exp(-BUBBLES.DRAG * dt);
    const { x: bx, yMin, yMax, z: bz } = this.bounds;
    for (const b of [...this.bubbles]) {
      b.age += dt * (b.held ? 0.3 : 1);
      if (b.held) {
        b.r = Math.min(BUBBLES.MAX_R, b.r + BUBBLES.GROW * dt * (1 - b.r / (BUBBLES.MAX_R * 1.15)));
        continue;
      }
      if (this.thickness(b) < BUBBLES.POP_NM) {
        this.burst(b, 'thin');
        continue;
      }
      const t = this.time;
      // air currents
      b.v[0] += Math.sin(t * 0.7 + b.seed) * 0.12 * dt;
      b.v[1] += (Math.sin(t * 0.5 + b.seed * 1.3) * 0.1 - BUBBLES.SINK) * dt;
      b.v[2] += Math.cos(t * 0.6 + b.seed * 0.7) * 0.06 * dt;
      // a moving hand pushes the air around it
      for (const w of this.wind) {
        const d = Math.hypot(b.p[0] - w.p[0], b.p[1] - w.p[1], b.p[2] - w.p[2]);
        if (d < w.r) {
          const k = (1 - d / w.r) * 2.4 * dt;
          for (let i = 0; i < 3; i++) b.v[i] += w.v[i] * k;
        }
      }
      // soft walls
      if (b.p[0] > bx - b.r) b.v[0] -= (b.p[0] - bx + b.r) * 4 * dt;
      if (b.p[0] < -bx + b.r) b.v[0] -= (b.p[0] + bx - b.r) * 4 * dt;
      if (b.p[1] > yMax - b.r) b.v[1] -= (b.p[1] - yMax + b.r) * 4 * dt;
      if (b.p[1] < yMin + b.r) b.v[1] -= (b.p[1] - yMin - b.r) * 4 * dt;
      if (b.p[2] > bz) b.v[2] -= (b.p[2] - bz) * 4 * dt;
      if (b.p[2] < -bz) b.v[2] -= (b.p[2] + bz) * 4 * dt;
      for (let i = 0; i < 3; i++) {
        b.v[i] = clamp(b.v[i] * drag, -4, 4);
        b.p[i] += b.v[i] * dt;
      }
    }
    // bubbles that bump into each other drift apart instead of passing through
    const list = this.bubbles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.p[0] - a.p[0];
        const dy = b.p[1] - a.p[1];
        const dz = b.p[2] - a.p[2];
        const d = Math.hypot(dx, dy, dz) || 1e-3;
        const min = (a.r + b.r) * 0.95;
        if (d < min) {
          const push = ((min - d) / d) * 0.5;
          for (const [o, s] of [[a, -1], [b, 1]]) {
            if (o.held) continue;
            o.p[0] += dx * push * s;
            o.p[1] += dy * push * s;
            o.p[2] += dz * push * s;
          }
        }
      }
    }
    // fingertips burst whatever they touch (a bubble being blown is safe, and a newborn gets a moment)
    for (const f of this.pokers) {
      for (const b of [...this.bubbles]) {
        if (b.held || this.time - b.born < 0.35) continue;
        const d = Math.hypot(b.p[0] - f.p[0], b.p[1] - f.p[1], b.p[2] - f.p[2]);
        if (d < b.r + f.r) this.burst(b, 'touch');
      }
    }
    const events = this._events;
    this._events = [];
    return events;
  }
}
