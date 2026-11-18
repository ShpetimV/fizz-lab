import * as THREE from 'three';
import { BEAM, BB, PART } from './batches.js';
import { COL, PARTY } from '../config.js';
import { clamp, easeOutCubic } from '../core/math.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();

function randomUnit(out) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

/**
 * Transient effects: every event is staged as anticipation → pop → settle.
 * Owns no geometry of its own; it writes into the shared immediate-mode batches.
 */
export class Effects {
  constructor({ stage, beams, glow, text, particles, grid }) {
    this.stage = stage;
    this.beams = beams;
    this.glow = glow;
    this.text = text;
    this.particles = particles;
    this.grid = grid;
    this.bolts = [];
    this.rings = [];
    this.flares = [];
    this.flash = 0;
    this.glitch = 0;
    this.shock = { age: 10, x: 0.5, y: 0.5 };
    this.time = 0;
  }

  // ---- emitters ---------------------------------------------------------
  /** Elastic strand between two live positions (Vector3 refs are re-read every frame). */
  bolt(a, b, dur = 0.35, col = COL.white, width = 0.03) {
    this.bolts.push({ a, b, t: 0, dur, col, width, seed: Math.random() * 100 });
  }

  ring(p, size = 5, col = COL.accent, dur = 0.9) {
    this.rings.push({ p: p.clone(), t: 0, dur, size, col });
  }

  /** A four-point sparkle that pops and turns. */
  flare(p, size = 2, col = COL.white, dur = 0.5) {
    this.flares.push({ p: p.clone(), t: 0, dur, size, col, turn: Math.random() * 1.5 });
  }

  /** Party-coloured dots that pop outward, then flutter down. */
  confetti(p, count, speed = 3, life = 1.9) {
    const ps = this.particles;
    for (let i = 0, n = ps.n(count); i < n; i++) {
      randomUnit(_u).multiplyScalar(speed * (0.3 + Math.random() * 0.8));
      _u.y = _u.y * 0.8 + speed * 0.28;
      ps.emit(
        p.x, p.y, p.z, _u.x, _u.y, _u.z * 0.7, life * (0.6 + Math.random() * 0.5), PART.CONFETTI,
        PARTY[(Math.random() * PARTY.length) | 0], 0.06 + Math.random() * 0.07,
      );
    }
  }

  /** Full-screen shock ripple centred on a world position. */
  shockwave(p) {
    this.stage.project(p, _a);
    this.stage.windowToScreen(_a.x, _a.y, _b);
    this.shock = { age: 0, x: _b.x * 0.5 + 0.5, y: _b.y * 0.5 + 0.5 };
    this.grid.uniforms.uPulse.value = 0;
  }

  burst(p, count, col, speed = 2, size = 0.07, life = 0.9) {
    const ps = this.particles;
    for (let i = 0, n = ps.n(count); i < n; i++) {
      randomUnit(_u).multiplyScalar(speed * (0.25 + Math.random() * 0.9));
      ps.emit(p.x, p.y, p.z, _u.x, _u.y, _u.z, life * (0.5 + Math.random() * 0.7), PART.BURST, col, size * (0.5 + Math.random()));
    }
  }

  /** Particles spiralling in from a shell onto p (atom materialisation). */
  converge(p, count, col, radius = 1.8, life = 0.5) {
    const ps = this.particles;
    for (let i = 0, n = ps.n(count); i < n; i++) {
      randomUnit(_u).multiplyScalar(radius * (0.45 + Math.random() * 0.75));
      ps.emit(
        p.x + _u.x, p.y + _u.y, p.z + _u.z * 0.6, p.x, p.y, p.z,
        life * (0.7 + Math.random() * 0.4), PART.CONVERGE, Math.random() < 0.3 ? COL.white : col,
        0.03 + Math.random() * 0.035, Math.random() * life * 0.25,
      );
    }
  }

  /** Shards that fly out of `from` and re-assemble at `to`. */
  reform(from, to, count, col, spread = 0.3, life = 0.8) {
    const ps = this.particles;
    for (let i = 0, n = ps.n(count); i < n; i++) {
      randomUnit(_u).multiplyScalar(spread * Math.random());
      randomUnit(_w).multiplyScalar(0.12 * Math.random());
      ps.emit(
        from.x + _u.x, from.y + _u.y, from.z + _u.z, to.x + _w.x, to.y + _w.y, to.z + _w.z,
        life * (0.75 + Math.random() * 0.4), PART.REFORM, Math.random() < 0.25 ? COL.white : col,
        0.03 + Math.random() * 0.04, Math.random() * 0.08,
      );
    }
  }

  // ---- immediate helpers --------------------------------------------------
  /** Wobbly elastic strand from a to b: two slow travelling waves, pinned at both ends. */
  drawBolt(a, b, col, width, alpha, seed, amp = 0.22, segments = 12) {
    const t = this.time;
    _d.subVectors(b, a);
    const len = _d.length();
    if (len < 1e-4) return;
    _u.set(-_d.y, _d.x, 0);
    if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0);
    _u.normalize();
    _w.crossVectors(_d, _u).normalize();
    _p.copy(a);
    for (let i = 1; i <= segments; i++) {
      const f = i / segments;
      const env = Math.sin(Math.PI * f) * amp * Math.min(1, len);
      const n1 = Math.sin(f * 9.4 - t * 11 + seed) * 0.5;
      const n2 = Math.cos(f * 6.3 + t * 8 + seed * 1.7) * 0.5;
      _c.copy(a).addScaledVector(_d, f).addScaledVector(_u, n1 * env).addScaledVector(_w, n2 * env);
      this.beams.add(_p, _c, col, col, width, alpha, BEAM.SOLID);
      _p.copy(_c);
    }
  }

  /**
   * Arc of `radius` around `centre` from direction dA to dB (unit vectors),
   * drawn up to `reveal` (0..1), with a label at its middle.
   */
  drawAngleArc(centre, dA, dB, radius, reveal, col, alpha, label) {
    const ang = Math.acos(clamp(dA.dot(dB), -1, 1));
    if (ang < 0.02) return;
    const segs = Math.max(6, Math.round(ang * 7));
    // slerp basis: handles the 180° case with any perpendicular
    _u.copy(dB).addScaledVector(dA, -dA.dot(dB));
    if (_u.lengthSq() < 1e-6) {
      _u.set(-dA.y, dA.x, 0);
      if (_u.lengthSq() < 1e-6) _u.set(0, 1, 0);
    }
    _u.normalize();
    const shown = ang * reveal;
    _p.copy(centre).addScaledVector(dA, radius);
    for (let i = 1; i <= segs; i++) {
      const th = Math.min(shown, (ang * i) / segs);
      _c.copy(centre).addScaledVector(dA, Math.cos(th) * radius).addScaledVector(_u, Math.sin(th) * radius);
      this.beams.add(_p, _c, col, col, 0.011, alpha, BEAM.SOLID);
      _p.copy(_c);
      if (th >= shown) break;
    }
    // write-head spark while drawing, end ticks when complete
    if (reveal < 1) this.glow.add(_p, 0.07, COL.white, alpha, BB.DOT);
    if (label && reveal > 0.55) {
      const th = ang * 0.5;
      const lr = radius + 0.3;
      _c.copy(centre).addScaledVector(dA, Math.cos(th) * lr).addScaledVector(_u, Math.sin(th) * lr);
      this.text.draw(label, _c, 0.24, COL.white, alpha * clamp((reveal - 0.55) / 0.3, 0, 1));
    }
  }

  // ---- per frame ----------------------------------------------------------
  update(dt, time) {
    this.time = time;
    const { glow } = this;

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const f = b.t / b.dur;
      if (f >= 1) {
        this.bolts.splice(i, 1);
        continue;
      }
      // the strand tightens as the atoms close in, then snaps into the bond
      this.drawBolt(b.a, b.b, b.col, b.width * (0.7 + f * 0.6), 0.55 + 0.45 * f, b.seed, 0.3 * (1 - f * 0.85));
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.dur;
      if (f >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const e = easeOutCubic(f);
      glow.add(r.p, r.size, r.col, (1 - f) * (1 - f), BB.RING, 0.08 + e * 0.84, 0.012 * (1 - f * 0.5));
    }

    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fl = this.flares[i];
      fl.t += dt;
      const f = fl.t / fl.dur;
      if (f >= 1) {
        this.flares.splice(i, 1);
        continue;
      }
      const k = (1 - f) * (1 - f);
      glow.add(fl.p, fl.size * 0.34 * (0.5 + easeOutCubic(f) * 0.7), fl.col, k, BB.SPARKLE, fl.turn + f * 1.2);
    }

    // post-process drivers
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.glitch = Math.max(0, this.glitch - dt * 2.8);
    this.shock.age += dt;
    this.grid.uniforms.uPulse.value += dt;
    const fu = this.stage.final.uniforms;
    fu.uFlash.value = this.flash;
    fu.uGlitch.value = this.glitch;
    const sa = this.shock.age;
    const sv = fu.uShock.value;
    sv[0] = this.shock.x;
    sv[1] = this.shock.y;
    sv[2] = easeOutCubic(sa / 1.3) * 1.3;
    sv[3] = sa < 1.3 ? (1 - sa / 1.3) : 0;
  }
}
