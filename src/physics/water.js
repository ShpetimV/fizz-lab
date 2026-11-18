// Water phases: a small rigid-molecule force simulation. Pure module (plain
// arrays, no DOM / Three.js) so the lattice logic can be unit-tested.
//
// What is simulated
//   * every molecule is a rigid H–O–H body (104.5°) with position + orientation
//   * hydrogen bonds: each H is pulled toward the nearest oxygen of another
//     molecule (which makes the molecule turn to point its H at that oxygen)
//   * short-range O···O and H···H repulsion, weak cohesion, gravity for the liquid
//   * a Langevin thermostat: random thermal kicks that grow with temperature
// What is guided
//   * 40 molecules cannot nucleate real ice in real time, so below 0 °C each
//     molecule is additionally drawn toward a site of a pre-built ice-Ih
//     lattice (correct hexagonal structure, four H-bonded neighbours each,
//     proton-ordered according to the ice rules).
import { v3, quat, makeRng, gaussian, clamp } from '../core/math.js';

const DEG = Math.PI / 180;
export const HOH_ANGLE = 104.5;
// Real geometry ratio: O–H 0.957 Å vs O···O 2.76 Å in ice.
export const OH_RATIO = 0.9572 / 2.76;

export const FREEZE_C = 0;
export const BOIL_C = 100;
const HYST = 2.5; // °C of hysteresis so the phase label cannot flicker at a boundary

// ---------------------------------------------------------------- ice lattice
function quatFromBasis(X, Y, Z) {
  // rotation matrix with columns X, Y, Z -> quaternion [x, y, z, w]
  const m00 = X[0], m10 = X[1], m20 = X[2];
  const m01 = Y[0], m11 = Y[1], m21 = Y[2];
  const m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return quat.norm(q);
}

/** Orientation that points a molecule's two O–H bonds (as nearly as 104.5° allows) along dA and dB. */
export function orientationFor(dA, dB) {
  const b = v3.norm(v3.add(dA, dB)); // bisector between the hydrogens
  const X = v3.norm(v3.sub(dB, dA)); // H1 -> H2
  const Y = v3.scale(b, -1); // local +Y points away from the hydrogens
  const Z = v3.cross(X, Y);
  return quatFromBasis(X, Y, Z);
}

/**
 * Build a finite piece of ice Ih (hexagonal ice): oxygen sites on a wurtzite
 * lattice, every oxygen tetrahedrally surrounded at distance d, with hydrogen
 * positions chosen to satisfy the ice rules:
 *   – every O has exactly two H of its own,
 *   – every O···O link carries exactly one H.
 *
 * @returns {{ sites: {pos:number[], dirs:number[][], neighbors:number[], donors:number[], quat:number[]}[],
 *             links: {from:number, to:number}[], d:number }}
 *          `links` are directed donor -> acceptor.
 */
export function buildIceLattice(count = 40, d = 1) {
  const a = d * Math.sqrt(8 / 3);
  const c = (d * 8) / 3;
  const a1 = [a, 0, 0];
  const a2 = [-a / 2, (a * Math.sqrt(3)) / 2, 0]; // hexagonal cell: 120° between a1 and a2
  const basis = [[1 / 3, 2 / 3, 0], [2 / 3, 1 / 3, 1 / 2], [1 / 3, 2 / 3, 3 / 8], [2 / 3, 1 / 3, 7 / 8]];
  const all = [];
  const R = 6;
  for (let i = -R; i <= R; i++) {
    for (let j = -R; j <= R; j++) {
      for (let k = -1; k <= 2; k++) {
        for (const [fx, fy, fz] of basis) {
          all.push({
            pos: [(i + fx) * a1[0] + (j + fy) * a2[0], (i + fx) * a1[1] + (j + fy) * a2[1], (k + fz) * c],
            zf: k + fz,
          });
        }
      }
    }
  }
  // A slab of two puckered hexagonal sheets (z = 3/8c … 1c), joined by vertical bonds.
  const slab = all.filter((s) => s.zf > 0.3 && s.zf < 1.05);
  let cx = 0, cy = 0, cz = 0;
  // centre the pick on the middle of a hexagonal channel so the patch looks symmetric
  const centre = [0, 0, ((3 / 8 + 1) / 2) * c];
  slab.sort((p, q) => {
    const dp = Math.hypot(p.pos[0] - centre[0], (p.pos[1] - centre[1]) * 1.25);
    const dq = Math.hypot(q.pos[0] - centre[0], (q.pos[1] - centre[1]) * 1.25);
    return dp - dq || p.pos[2] - q.pos[2];
  });
  const chosen = slab.slice(0, count);
  for (const s of chosen) {
    cx += s.pos[0]; cy += s.pos[1]; cz += s.pos[2];
  }
  cx /= chosen.length; cy /= chosen.length; cz /= chosen.length;

  const index = new Map(chosen.map((s, i) => [s, i]));
  const sites = chosen.map((s) => {
    const dirs = [];
    const neighbors = [];
    for (const o of all) {
      if (o === s) continue;
      const dv = v3.sub(o.pos, s.pos);
      const l = v3.len(dv);
      if (Math.abs(l - d) < d * 0.02) {
        dirs.push(v3.scale(dv, 1 / l));
        neighbors.push(index.has(o) ? index.get(o) : -1);
      }
    }
    return { pos: [s.pos[0] - cx, s.pos[1] - cy, s.pos[2] - cz], dirs, neighbors, donors: [], quat: [0, 0, 0, 1] };
  });

  // ---- orient every O···O link (who donates the H) with a balanced Euler orientation
  const edges = []; // [u, v] with u < v, real links only
  sites.forEach((s, u) => s.neighbors.forEach((v) => {
    if (v > u) edges.push([u, v]);
  }));
  const DUMMY = sites.length;
  const degree = new Array(sites.length).fill(0);
  for (const [u, v] of edges) {
    degree[u]++;
    degree[v]++;
  }
  const allEdges = edges.map((e) => [...e]);
  degree.forEach((deg, u) => {
    if (deg % 2 === 1) allEdges.push([u, DUMMY]);
  });
  const adj = Array.from({ length: sites.length + 1 }, () => []);
  allEdges.forEach(([u, v], ei) => {
    adj[u].push(ei);
    adj[v].push(ei);
  });
  const used = new Array(allEdges.length).fill(false);
  const cursor = new Array(adj.length).fill(0);
  const orient = new Array(allEdges.length).fill(null); // [from, to]
  // Hierholzer: walk closed trails, orienting each edge in walking direction
  for (let start = 0; start < adj.length; start++) {
    const stack = [start];
    while (stack.length) {
      const u = stack[stack.length - 1];
      while (cursor[u] < adj[u].length && used[adj[u][cursor[u]]]) cursor[u]++;
      if (cursor[u] === adj[u].length) {
        stack.pop();
        continue;
      }
      const ei = adj[u][cursor[u]];
      used[ei] = true;
      const [p, q] = allEdges[ei];
      const v = p === u ? q : p;
      orient[ei] = [u, v];
      stack.push(v);
    }
  }
  const links = [];
  edges.forEach((_, ei) => {
    const [from, to] = orient[ei];
    links.push({ from, to });
    sites[from].donors.push(sites[from].neighbors.indexOf(to));
  });
  // molecules at the surface point their spare hydrogens along dangling directions
  sites.forEach((s) => {
    for (let k = 0; k < 4 && s.donors.length < 2; k++) {
      if (s.neighbors[k] === -1 && !s.donors.includes(k)) s.donors.push(k);
    }
    s.quat = orientationFor(s.dirs[s.donors[0]], s.dirs[s.donors[1]]);
  });
  return { sites, links, d };
}

// ---------------------------------------------------------------- simulation
export function phaseFor(tempC, previous = 'LIQUID') {
  // hysteresis around the two transition temperatures of water at 1 atm
  if (previous === 'ICE') return tempC > FREEZE_C + HYST ? (tempC > BOIL_C ? 'GAS' : 'LIQUID') : 'ICE';
  if (previous === 'GAS') return tempC < BOIL_C - HYST ? (tempC < FREEZE_C ? 'ICE' : 'LIQUID') : 'GAS';
  if (tempC < FREEZE_C - HYST) return 'ICE';
  if (tempC > BOIL_C + HYST) return 'GAS';
  return 'LIQUID';
}

export class WaterSim {
  constructor({ count = 40, box = [4.4, 2.7, 2.1], d = 1.12, seed = 7 } = {}) {
    this.n = count;
    this.box = box;
    this.d = d;
    this.L = d * OH_RATIO * 1.12; // O–H length (drawn slightly long so the molecules read clearly)
    const half = (HOH_ANGLE / 2) * DEG;
    this.h1 = [-Math.sin(half) * this.L, -Math.cos(half) * this.L, 0];
    this.h2 = [Math.sin(half) * this.L, -Math.cos(half) * this.L, 0];
    this.rng = makeRng(seed);
    this.temp = 25;
    this.phase = 'LIQUID';
    this.ice = 0; // 0..1 crystallisation progress
    this.gas = 0; // 0..1 vaporisation progress
    this.iceClock = 0;
    this.lattice = buildIceLattice(count, d);
    this.latticeR = Math.max(...this.lattice.sites.map((s) => Math.hypot(s.pos[0], s.pos[1])));
    this.site = new Int32Array(count).fill(-1);
    this.lock = new Float32Array(count);

    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.q = new Float32Array(count * 4);
    this.w = new Float32Array(count * 3);
    this.H = new Float32Array(count * 6); // world positions of both hydrogens
    this.force = new Float32Array(count * 3);
    this.torque = new Float32Array(count * 3);
    this.hbonds = []; // { mol, h (0|1), to, strength }
    this.hbondCount = 0;
    this.accepted = new Int8Array(count);

    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (rng() - 0.5) * box[0] * 1.5;
      this.pos[i * 3 + 1] = -box[1] * 0.2 - rng() * box[1] * 0.7;
      this.pos[i * 3 + 2] = (rng() - 0.5) * box[2] * 1.5;
      const qr = quat.norm([gaussian(rng), gaussian(rng), gaussian(rng), gaussian(rng)]);
      this.q.set(qr, i * 4);
    }
    this.updateSites();
  }

  setTemperature(tempC) {
    this.temp = tempC;
  }

  getQuat(i) {
    const q = this.q;
    return [q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]];
  }

  updateSites() {
    for (let i = 0; i < this.n; i++) {
      const q = this.getQuat(i);
      const a = quat.rotate(q, this.h1);
      const b = quat.rotate(q, this.h2);
      const px = this.pos[i * 3], py = this.pos[i * 3 + 1], pz = this.pos[i * 3 + 2];
      this.H[i * 6] = px + a[0]; this.H[i * 6 + 1] = py + a[1]; this.H[i * 6 + 2] = pz + a[2];
      this.H[i * 6 + 3] = px + b[0]; this.H[i * 6 + 4] = py + b[1]; this.H[i * 6 + 5] = pz + b[2];
    }
  }

  /** Greedy nearest assignment of molecules to lattice sites when freezing starts. */
  assignSites() {
    const n = this.n;
    const pairs = [];
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < n; s++) {
        const p = this.lattice.sites[s].pos;
        pairs.push([Math.hypot(this.pos[i * 3] - p[0], this.pos[i * 3 + 1] - p[1], this.pos[i * 3 + 2] - p[2]), i, s]);
      }
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const molDone = new Uint8Array(n);
    const siteDone = new Uint8Array(n);
    this.site.fill(-1);
    for (const [, i, s] of pairs) {
      if (molDone[i] || siteDone[s]) continue;
      molDone[i] = 1;
      siteDone[s] = 1;
      this.site[i] = s;
    }
  }

  step(dtFrame) {
    const prev = this.phase;
    this.phase = phaseFor(this.temp, prev);
    const changed = prev !== this.phase ? { from: prev, to: this.phase } : null;
    if (this.phase === 'ICE' && prev !== 'ICE') {
      this.assignSites();
      this.iceClock = 0;
    }
    const dtClamped = Math.min(dtFrame, 1 / 30);
    const sub = 2;
    for (let s = 0; s < sub; s++) this.substep(dtClamped / sub);
    return changed;
  }

  substep(dt) {
    const n = this.n;
    const { pos, vel, w, H, force, torque, box, d } = this;
    const isIce = this.phase === 'ICE';
    const isGas = this.phase === 'GAS';
    this.ice = clamp(this.ice + (isIce ? dt / 2.4 : -dt / 1.2), 0, 1);
    this.gas = clamp(this.gas + (isGas ? dt / 1.0 : -dt / 1.4), 0, 1);
    this.iceClock += isIce ? dt : -dt * 2;
    this.iceClock = clamp(this.iceClock, 0, 4);
    const liquid = (1 - this.gas) * (1 - this.ice);
    const bound = 1 - this.gas; // how much intermolecular attraction survives the heat

    force.fill(0);
    torque.fill(0);
    this.accepted.fill(0);
    this.hbonds.length = 0;

    // ---- pair forces between oxygens: core repulsion + weak cohesion
    const r0 = d * (0.95 + 0.05 * this.ice);
    const rc = d * 1.9;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3];
        const dy = pos[j * 3 + 1] - pos[i * 3 + 1];
        const dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > rc * rc) continue;
        const r = Math.sqrt(r2) || 1e-4;
        let f = 0;
        if (r < r0) f = -90 * (r0 - r);
        else f = 3.2 * bound * (1 - this.ice * 0.7) * Math.sin((Math.PI * (r - r0)) / (rc - r0));
        const fx = (dx / r) * f, fy = (dy / r) * f, fz = (dz / r) * f;
        force[i * 3] += fx; force[i * 3 + 1] += fy; force[i * 3 + 2] += fz;
        force[j * 3] -= fx; force[j * 3 + 1] -= fy; force[j * 3 + 2] -= fz;

        // hydrogens of different molecules keep apart
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            const hx = H[j * 6 + b * 3] - H[i * 6 + a * 3];
            const hy = H[j * 6 + b * 3 + 1] - H[i * 6 + a * 3 + 1];
            const hz = H[j * 6 + b * 3 + 2] - H[i * 6 + a * 3 + 2];
            const hr = Math.hypot(hx, hy, hz) || 1e-4;
            const hmin = d * 0.5;
            if (hr < hmin) {
              const hf = -40 * (hmin - hr);
              this.applyAt(i, a, (hx / hr) * hf, (hy / hr) * hf, (hz / hr) * hf);
              this.applyAt(j, b, (-hx / hr) * hf, (-hy / hr) * hf, (-hz / hr) * hf);
            }
          }
        }
      }
    }

    // ---- hydrogen bonds: each H is drawn to the nearest foreign oxygen (max two per oxygen)
    const hbIdeal = d - this.L; // H···O distance when O···O = d
    const hbMax = d * 0.98;
    const kHb = 26 * bound;
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 2; a++) {
        const hx = H[i * 6 + a * 3], hy = H[i * 6 + a * 3 + 1], hz = H[i * 6 + a * 3 + 2];
        let best = -1;
        let bestR = hbMax;
        for (let j = 0; j < n; j++) {
          if (j === i || this.accepted[j] >= 2) continue;
          const r = Math.hypot(pos[j * 3] - hx, pos[j * 3 + 1] - hy, pos[j * 3 + 2] - hz);
          if (r < bestR) {
            bestR = r;
            best = j;
          }
        }
        if (best < 0) continue;
        this.accepted[best]++;
        const dx = pos[best * 3] - hx, dy = pos[best * 3 + 1] - hy, dz = pos[best * 3 + 2] - hz;
        const fall = clamp((hbMax - bestR) / (hbMax - hbIdeal) * 1.6, 0, 1); // fades out at the cutoff
        const f = kHb * (bestR - hbIdeal) * fall;
        const fx = (dx / bestR) * f, fy = (dy / bestR) * f, fz = (dz / bestR) * f;
        this.applyAt(i, a, fx, fy, fz);
        force[best * 3] -= fx; force[best * 3 + 1] -= fy; force[best * 3 + 2] -= fz;
        if (bound > 0.25) this.hbonds.push({ mol: i, h: a, to: best, strength: fall * bound });
      }
    }
    this.hbondCount = this.hbonds.length;

    // ---- crystallisation guide: nucleates at the centre and grows outward
    const sites = this.lattice.sites;
    for (let i = 0; i < n; i++) {
      const s = this.site[i];
      let lock = 0;
      if (s >= 0) {
        const delay = (Math.hypot(sites[s].pos[0], sites[s].pos[1]) / this.latticeR) * 1.5;
        lock = clamp((this.iceClock - delay) / 0.9, 0, 1);
      }
      this.lock[i] = lock;
      if (lock <= 0) continue;
      const sp = sites[s].pos;
      const k = 34 * lock * lock;
      force[i * 3] += (sp[0] - pos[i * 3]) * k;
      force[i * 3 + 1] += (sp[1] - pos[i * 3 + 1]) * k;
      force[i * 3 + 2] += (sp[2] - pos[i * 3 + 2]) * k;
      // align with the proton-ordered orientation (either H labelling is the same molecule)
      const q = this.getQuat(i);
      let target = sites[s].quat;
      const flipped = quat.mul(target, [0, 1, 0, 0]);
      const dot = (u) => Math.abs(u[0] * q[0] + u[1] * q[1] + u[2] * q[2] + u[3] * q[3]);
      if (dot(flipped) > dot(target)) target = flipped;
      let e = quat.mul(target, quat.conj(q));
      if (e[3] < 0) e = [-e[0], -e[1], -e[2], -e[3]];
      const kr = 9 * lock;
      torque[i * 3] += e[0] * 2 * kr;
      torque[i * 3 + 1] += e[1] * 2 * kr;
      torque[i * 3 + 2] += e[2] * 2 * kr;
    }

    // ---- thermostat, gravity, walls, integration
    const tK = this.temp + 273.15;
    const vIce = 0.05 + 0.3 * clamp(tK / 273, 0, 1);
    const vLiq = 0.75 + 0.55 * clamp((this.temp - FREEZE_C) / 100, 0, 1);
    const vGas = 3.2 + 2.6 * clamp((this.temp - BOIL_C) / 60, 0, 1);
    let vth = vLiq + (vIce - vLiq) * this.ice;
    vth += (vGas - vth) * this.gas;
    const gamma = 3.2 + 3.5 * this.ice - 2.8 * this.gas;
    const kick = Math.sqrt(2 * gamma * dt) * vth;
    const gravity = -6.5 * liquid;
    const inertia = 0.07;
    const gammaR = 5 + 4 * this.ice - 3.5 * this.gas;
    const wth = vth * 3.2;
    const kickR = Math.sqrt(2 * gammaR * dt) * wth;
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const idx = i * 3 + k;
        let acc = force[idx];
        if (k === 1) acc += gravity;
        vel[idx] += acc * dt;
        vel[idx] = vel[idx] * (1 - gamma * dt) + kick * gaussian(rng);
        // walls
        const lim = box[k];
        if (pos[idx] > lim) {
          vel[idx] -= (pos[idx] - lim) * 60 * dt;
          if (vel[idx] > 0) vel[idx] *= isGas ? -0.9 : 0.5;
        } else if (pos[idx] < -lim) {
          vel[idx] -= (pos[idx] + lim) * 60 * dt;
          if (vel[idx] < 0) vel[idx] *= isGas ? -0.9 : 0.5;
        }
        vel[idx] = clamp(vel[idx], -14, 14);
        pos[idx] += vel[idx] * dt;

        w[idx] += (torque[idx] / inertia) * dt;
        w[idx] = w[idx] * (1 - gammaR * dt) + kickR * gaussian(rng);
        w[idx] = clamp(w[idx], -30, 30);
      }
      // integrate orientation: q += ½ dt (ω ⊗ q)
      const q = this.getQuat(i);
      const dq = quat.mul([w[i * 3], w[i * 3 + 1], w[i * 3 + 2], 0], q);
      const nq = quat.norm([q[0] + 0.5 * dt * dq[0], q[1] + 0.5 * dt * dq[1], q[2] + 0.5 * dt * dq[2], q[3] + 0.5 * dt * dq[3]]);
      this.q.set(nq, i * 4);
    }
    this.updateSites();
  }

  /** Apply a force at hydrogen `h` of molecule `i`: accelerates and twists the molecule. */
  applyAt(i, h, fx, fy, fz) {
    const { force, torque, pos, H } = this;
    force[i * 3] += fx; force[i * 3 + 1] += fy; force[i * 3 + 2] += fz;
    const rx = H[i * 6 + h * 3] - pos[i * 3];
    const ry = H[i * 6 + h * 3 + 1] - pos[i * 3 + 1];
    const rz = H[i * 6 + h * 3 + 2] - pos[i * 3 + 2];
    torque[i * 3] += ry * fz - rz * fy;
    torque[i * 3 + 1] += rz * fx - rx * fz;
    torque[i * 3 + 2] += rx * fy - ry * fx;
  }

  /** Mean number of hydrogen bonds each molecule takes part in (ice → 4). */
  bondsPerMolecule() {
    return (this.hbondCount * 2) / this.n;
  }
}
