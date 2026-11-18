// Liquid metal toy. Pure module: no DOM, no Three.js.
//
// The liquid is a handful of overlapping spheres ("cells") that the renderer
// melts into one surface with a smooth minimum. Physics is deliberately simple
// and stable rather than a fluid solver:
//   * cohesion  – neighbouring cells are bonded by soft springs (surface
//                 tension). A bond that is stretched too far tears, so pulling
//                 hard pinches a droplet off; cells that touch again re-bond.
//   * droplets  – connected groups of bonded cells. Stray droplets drift back
//                 toward the main body after a moment and merge on contact.
//   * input     – a held cell follows a hand, fingertips push cells aside,
//                 a magnet pulls (ferrofluid only), a splash scatters them.
import { makeRng, clamp, smoothstep } from '../core/math.js';

export const LIQUID = {
  BLEND: 0.32, // smooth-min width used by the renderer; bonds form at about this gap
  SUBSTEP: 1 / 240,
  MAX_SUBSTEPS: 10,
  K_TENSION: 30, // bond spring (pull)
  K_PRESSURE: 70, // bond spring (push, keeps the blob from collapsing)
  DAMP_BOND: 2,
  DRAG: 1.6,
  K_HOLD: 60,
  HOLD_MAX: 80, // strong enough to tear a droplet off, too weak to drag the whole body along
  DAMP_HOLD: 9,
  K_HOME: 3,
  MAX_BONDS: 6, // each cell holds on to its nearest neighbours only
  RETURN_ACCEL: 3.2, // stray droplets drift back at this acceleration…
  RETURN_DELAY: 1.2, // …after being apart this long (s)
  BOND_AT: 0.92, // × (ri + rj): touching cells bond
  REST: 0.6, // × (ri + rj): relaxed spacing of bonded cells
  CORE: 0.4, // × (ri + rj): closer than this they push apart hard
  PEAK: 0.95, // × (ri + rj): a stretched bond pulls hardest here, then gives way
  TEAR_AT: 1.45, // × (ri + rj): …and is gone by here
};

const v3 = () => [0, 0, 0];

export class LiquidSim {
  /**
   * @param count  number of cells
   * @param radius mean cell radius (scene units)
   * @param home   where the main body rests
   * @param bounds { x, yMin, yMax, z } soft walls
   */
  constructor({ count = 16, radius = 0.4, home = [0, -0.3, 0], bounds = { x: 6, yMin: -3.4, yMax: 2.2, z: 2.6 }, seed = 7 } = {}) {
    this.rng = makeRng(seed);
    this.home = [...home];
    this.bounds = bounds;
    this.time = 0;
    this.n = count;
    this.cells = Array.from({ length: count }, (_, i) => ({
      p: v3(),
      v: v3(),
      f: v3(),
      // a few big cells and a spray of small ones: splashes make droplets of different sizes
      r: radius * (i < 4 ? 1.25 : 0.65 + this.rng() * 0.5),
      delay: 0, // > 0: not poured in yet (inactive)
      hold: null, // [x, y, z] target while a hand holds it
      apart: 0, // seconds this cell has spent outside the main body
      loose: 0, // > 0: freshly splashed, cannot re-bond yet
      seed: this.rng() * 100,
    }));
    this.bonds = new Uint8Array(count * count);
    this.pokes = []; // [{ p: [x,y,z], r }]
    this.magnet = null; // { p: [x,y,z], strength 0..1 }
    this.drops = [];
    this.main = -1; // index into drops of the main body
    this.reset();
  }

  /** Gather all cells into one resting blob at home. */
  reset() {
    const [hx, hy, hz] = this.home;
    this.cells.forEach((c, i) => {
      // golden-angle spiral inside a ball: an even, overlapping pack
      const t = (i + 0.5) / this.n;
      const rr = 0.55 * Math.cbrt(t);
      const phi = i * 2.399963;
      const z = 1 - 2 * t;
      const s = Math.sqrt(1 - z * z);
      c.p = [hx + Math.cos(phi) * s * rr, hy + z * rr, hz + Math.sin(phi) * s * rr];
      c.v = v3();
      c.delay = 0;
      c.hold = null;
      c.apart = 0;
      c.loose = 0;
    });
    this.bonds.fill(0);
    this.formBonds();
    this.update();
  }

  /** Pour the liquid in: cells stream from `from` one after another. */
  pour(from, interval = 0.055) {
    this.cells.forEach((c, i) => {
      c.p = [from[0] + (this.rng() - 0.5) * 0.15, from[1], from[2] + (this.rng() - 0.5) * 0.15];
      c.v = [(this.rng() - 0.5) * 0.4, -5.5, 0];
      c.delay = 0.05 + i * interval;
      c.hold = null;
      c.apart = this.rng() * 0.5 + 2; // stream drops seek the main body right away
    });
    this.bonds.fill(0);
    this.update();
  }

  active(c) {
    return c.delay <= 0;
  }

  // ---------------------------------------------------------------- input
  /** Index of the cell whose surface is nearest to p, if within reach. */
  pick(p, reach = 0.4) {
    let best = -1;
    let bestD = reach;
    this.cells.forEach((c, i) => {
      if (!this.active(c)) return;
      const d = Math.hypot(c.p[0] - p[0], c.p[1] - p[1], c.p[2] - p[2]) - c.r;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  grab(i, target) {
    this.cells[i].hold = [...target];
  }

  move(i, target) {
    const h = this.cells[i]?.hold;
    if (h) {
      h[0] = target[0];
      h[1] = target[1];
      h[2] = target[2];
    }
  }

  release(i, vel = null) {
    const c = this.cells[i];
    if (!c) return;
    c.hold = null;
    if (vel) for (let k = 0; k < 3; k++) c.v[k] = clamp(vel[k] * 0.5, -6, 6);
  }

  /** Scatter cells near p: an impulse along `vel` plus a burst outward. */
  splash(p, vel = [0, 0, 0], radius = 1.6, power = 1) {
    let hit = 0;
    this.cells.forEach((c, i) => {
      if (!this.active(c) || c.hold) return;
      const dx = c.p[0] - p[0];
      const dy = c.p[1] - p[1];
      const dz = c.p[2] - p[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) return;
      const k = (1 - d / radius) * power;
      const out = 6 + this.rng() * 4;
      const inv = 1 / Math.max(d, 1e-3);
      const jitter = 4 * k;
      c.v[0] += vel[0] * 0.7 * k + dx * inv * out * k + (this.rng() - 0.5) * jitter;
      c.v[1] += vel[1] * 0.7 * k + dy * inv * out * k + (this.rng() - 0.5) * jitter;
      c.v[2] += vel[2] * 0.7 * k + dz * inv * out * k * 0.6 + (this.rng() - 0.5) * jitter * 0.5;
      // the impact breaks the cell free; it may stick to others again a moment later
      c.loose = 0.3 * k;
      for (let j = 0; j < this.n; j++) this.bonds[i < j ? i * this.n + j : j * this.n + i] = 0;
      hit++;
    });
    return hit;
  }

  // ---------------------------------------------------------------- simulation
  formBonds() {
    const { cells, n } = this;
    const degree = this._degree || (this._degree = new Uint8Array(n));
    degree.fill(0);
    const candidates = [];
    for (let i = 0; i < n; i++) {
      if (!this.active(cells[i])) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.active(cells[j])) continue;
        const a = cells[i];
        const b = cells[j];
        const d = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
        const sum = a.r + b.r;
        const k = i * n + j;
        if (this.bonds[k]) {
          if (d > sum * LIQUID.TEAR_AT) this.bonds[k] = 0;
          else {
            degree[i]++;
            degree[j]++;
          }
        } else if (d < sum * LIQUID.BOND_AT && a.loose <= 0 && b.loose <= 0) candidates.push({ k, i, j, f: d / sum });
      }
    }
    // closest pairs first, and nobody holds more than MAX_BONDS neighbours, except
    // where two separate droplets touch: they always merge
    candidates.sort((x, y) => x.f - y.f);
    const dropOf = this.dropOf;
    for (const c of candidates) {
      const merging = dropOf && dropOf[c.i] !== dropOf[c.j];
      if (!merging && (degree[c.i] >= LIQUID.MAX_BONDS || degree[c.j] >= LIQUID.MAX_BONDS)) continue;
      if (merging) dropOf[c.j] = dropOf[c.i]; // one bridge per touch is enough
      this.bonds[c.k] = 1;
      degree[c.i]++;
      degree[c.j]++;
    }
  }

  /** Advance by dt seconds. Returns events: [{ type: 'split' | 'merge', p, size }]. */
  step(dt) {
    const steps = Math.min(LIQUID.MAX_SUBSTEPS, Math.max(1, Math.round(dt / LIQUID.SUBSTEP)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.substep(h);
    return this.update();
  }

  substep(h) {
    const { cells, n } = this;
    this.time += h;
    for (const c of cells) {
      c.f[0] = 0;
      c.f[1] = 0;
      c.f[2] = 0;
      if (c.loose > 0) c.loose -= h;
      if (c.delay > 0) {
        c.delay -= h;
        continue;
      }
    }
    this.formBonds();

    // cohesion
    for (let i = 0; i < n; i++) {
      const a = cells[i];
      if (!this.active(a)) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.bonds[i * n + j]) continue;
        const b = cells[j];
        const dx = b.p[0] - a.p[0];
        const dy = b.p[1] - a.p[1];
        const dz = b.p[2] - a.p[2];
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const sum = a.r + b.r;
        const rest = sum * LIQUID.REST;
        const core = sum * LIQUID.CORE;
        const peak = sum * LIQUID.PEAK;
        const tear = sum * LIQUID.TEAR_AT;
        let f = 0;
        if (d > peak) f = LIQUID.K_TENSION * (peak - rest) * Math.max(0, (tear - d) / (tear - peak));
        else if (d > rest) f = LIQUID.K_TENSION * (d - rest);
        else if (d < core) f = -LIQUID.K_PRESSURE * (core - d);
        const ux = dx / d;
        const uy = dy / d;
        const uz = dz / d;
        const rv = (b.v[0] - a.v[0]) * ux + (b.v[1] - a.v[1]) * uy + (b.v[2] - a.v[2]) * uz;
        f += LIQUID.DAMP_BOND * rv;
        a.f[0] += f * ux; a.f[1] += f * uy; a.f[2] += f * uz;
        b.f[0] -= f * ux; b.f[1] -= f * uy; b.f[2] -= f * uz;
      }
    }

    // where stray droplets head: the main body (or home, for the main body itself)
    const main = this.drops[this.main];
    const target = main ? main.centre : this.home;
    const [bx, by0, by1, bz] = [this.bounds.x, this.bounds.yMin, this.bounds.yMax, this.bounds.z];
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      if (!this.active(c)) continue;
      const inMain = main && main.cells.includes(i);
      c.apart = inMain ? 0 : c.apart + h;
      if (inMain) {
        for (let k = 0; k < 3; k++) c.f[k] += (this.home[k] - main.centre[k]) * LIQUID.K_HOME;
      } else {
        const dx = target[0] - c.p[0];
        const dy = target[1] - c.p[1];
        const dz = target[2] - c.p[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const a = LIQUID.RETURN_ACCEL * smoothstep(LIQUID.RETURN_DELAY, LIQUID.RETURN_DELAY + 1.2, c.apart) * Math.min(1, d);
        c.f[0] += (dx / d) * a; c.f[1] += (dy / d) * a; c.f[2] += (dz / d) * a;
      }
      // a slow internal churn keeps the surface alive
      const t = this.time;
      c.f[0] += Math.sin(t * 1.3 + c.seed) * 0.35;
      c.f[1] += Math.sin(t * 1.1 + c.seed * 1.7) * 0.35;
      c.f[2] += Math.sin(t * 0.9 + c.seed * 2.3) * 0.25;

      // fingertips push the liquid aside
      for (const pk of this.pokes) {
        const dx = c.p[0] - pk.p[0];
        const dy = c.p[1] - pk.p[1];
        const dz = c.p[2] - pk.p[2];
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const reach = c.r * 0.8 + pk.r;
        if (d < reach) {
          const f = 160 * (reach - d);
          c.f[0] += (dx / d) * f; c.f[1] += (dy / d) * f; c.f[2] += (dz / d) * f;
        }
      }
      // magnet (ferrofluid): pulls the liquid toward it, stronger up close
      if (this.magnet && this.magnet.strength > 0) {
        const m = this.magnet;
        const dx = m.p[0] - c.p[0];
        const dy = m.p[1] - c.p[1];
        const dz = m.p[2] - c.p[2];
        const d = Math.hypot(dx, dy, dz) || 1e-4;
        const stop = c.r + 0.45; // it gathers below the hand instead of swallowing it
        const f = d > stop ? (m.strength * 7) / (1 + d * d * 0.35) : -m.strength * 20 * (stop - d);
        c.f[0] += (dx / d) * f; c.f[1] += (dy / d) * f; c.f[2] += (dz / d) * f;
      }
      // held: a stiff spring to the hand
      if (c.hold) {
        const hx = (c.hold[0] - c.p[0]) * LIQUID.K_HOLD;
        const hy = (c.hold[1] - c.p[1]) * LIQUID.K_HOLD;
        const hz = (c.hold[2] - c.p[2]) * LIQUID.K_HOLD;
        const m = Math.hypot(hx, hy, hz);
        const k = m > LIQUID.HOLD_MAX ? LIQUID.HOLD_MAX / m : 1;
        c.f[0] += hx * k - c.v[0] * LIQUID.DAMP_HOLD;
        c.f[1] += hy * k - c.v[1] * LIQUID.DAMP_HOLD;
        c.f[2] += hz * k - c.v[2] * LIQUID.DAMP_HOLD;
      }
      // soft walls
      if (c.p[0] > bx) c.f[0] -= (c.p[0] - bx) * 30;
      if (c.p[0] < -bx) c.f[0] -= (c.p[0] + bx) * 30;
      if (c.p[1] > by1) c.f[1] -= (c.p[1] - by1) * 30;
      if (c.p[1] < by0) c.f[1] -= (c.p[1] - by0) * 30;
      if (c.p[2] > bz) c.f[2] -= (c.p[2] - bz) * 30;
      if (c.p[2] < -bz) c.f[2] -= (c.p[2] + bz) * 30;
    }

    // integrate (semi-implicit Euler; mass ∝ volume so small droplets are livelier)
    const drag = Math.exp(-LIQUID.DRAG * h);
    for (const c of cells) {
      if (!this.active(c)) continue;
      const inv = 0.064 / (c.r * c.r * c.r); // a cell of radius 0.4 has unit mass
      for (let k = 0; k < 3; k++) {
        c.v[k] = clamp((c.v[k] + c.f[k] * Math.min(inv, 4) * h) * drag, -14, 14);
        c.p[k] += c.v[k] * h;
      }
    }
  }

  /** Recompute droplets (connected bonded cells) and report splits / merges. */
  update() {
    const { cells, n } = this;
    const seen = new Int16Array(n).fill(-1);
    const drops = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] >= 0 || !this.active(cells[i])) continue;
      const list = [i];
      seen[i] = drops.length;
      for (let q = 0; q < list.length; q++) {
        const a = list[q];
        for (let b = 0; b < n; b++) {
          if (seen[b] >= 0 || !this.active(cells[b])) continue;
          const k = a < b ? a * n + b : b * n + a;
          if (this.bonds[k]) {
            seen[b] = drops.length;
            list.push(b);
          }
        }
      }
      let vol = 0;
      const centre = [0, 0, 0];
      for (const i2 of list) {
        const c = cells[i2];
        const w = c.r * c.r * c.r;
        vol += w;
        for (let k = 0; k < 3; k++) centre[k] += c.p[k] * w;
      }
      for (let k = 0; k < 3; k++) centre[k] /= vol;
      drops.push({ cells: list, centre, volume: vol, radius: Math.cbrt(vol) * 1.05 });
    }
    let main = -1;
    drops.forEach((d, i) => {
      if (main < 0 || d.volume > drops[main].volume) main = i;
    });

    const events = [];
    const before = this.drops.length;
    if (before && drops.length && drops.length !== before) {
      // the smallest droplet is the one that just left or arrived
      const small = drops.reduce((m, d) => (m && m.volume <= d.volume ? m : d), null);
      if (drops.length > before) events.push({ type: 'split', p: small.centre, size: small.radius, count: drops.length });
      else {
        const big = drops[main];
        events.push({ type: 'merge', p: big.centre, size: big.radius, count: drops.length });
      }
    }
    this.drops = drops;
    this.main = main;
    this.dropOf = seen;
    return events;
  }

  /** The droplet whose centre is nearest to p. */
  dropNear(p) {
    let best = null;
    let bd = Infinity;
    for (const d of this.drops) {
      const dist = Math.hypot(d.centre[0] - p[0], d.centre[1] - p[1], d.centre[2] - p[2]) - d.radius;
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** Sphere enclosing every active cell. */
  bounds3() {
    const act = this.cells.filter((c) => this.active(c));
    if (!act.length) return null;
    const c = [0, 0, 0];
    for (const x of act) for (let k = 0; k < 3; k++) c[k] += x.p[k] / act.length;
    let r = 0;
    for (const x of act) r = Math.max(r, Math.hypot(x.p[0] - c[0], x.p[1] - c[1], x.p[2] - c[2]) + x.r);
    return { centre: c, radius: r };
  }
}
