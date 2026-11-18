import { describe, it, expect } from 'vitest';
import { buildIceLattice, orientationFor, phaseFor, WaterSim, HOH_ANGLE, OH_RATIO } from '../src/physics/water.js';
import { v3, quat, bestFitRotation, OneEuro } from '../src/core/math.js';

const DEG = 180 / Math.PI;

describe('ice Ih lattice', () => {
  const lat = buildIceLattice(40, 1);

  it('has the requested number of sites, centred', () => {
    expect(lat.sites).toHaveLength(40);
    const c = lat.sites.reduce((acc, s) => v3.add(acc, s.pos), [0, 0, 0]);
    expect(v3.len(c) / 40).toBeLessThan(1e-9);
  });

  it('every oxygen has four tetrahedral neighbour directions at 109.47°', () => {
    for (const s of lat.sites) {
      expect(s.dirs).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) expect(v3.angle(s.dirs[i], s.dirs[j]) * DEG).toBeCloseTo(109.4712, 3);
      }
    }
  });

  it('neighbouring oxygens sit exactly one O···O distance apart', () => {
    for (const s of lat.sites) {
      s.neighbors.forEach((n) => {
        if (n >= 0) expect(v3.len(v3.sub(lat.sites[n].pos, s.pos))).toBeCloseTo(1, 6);
      });
    }
  });

  it('is an open structure: most molecules have 3–4 bonded neighbours, never more than 4', () => {
    const degrees = lat.sites.map((s) => s.neighbors.filter((n) => n >= 0).length);
    expect(Math.max(...degrees)).toBeLessThanOrEqual(4);
    expect(degrees.filter((d) => d >= 3).length).toBeGreaterThan(20);
  });

  it('contains six-membered rings (hexagonal)', () => {
    // breadth-first search for a cycle of length 6 through site 0's neighbourhood
    const adj = lat.sites.map((s) => s.neighbors.filter((n) => n >= 0));
    let found = false;
    for (let start = 0; start < adj.length && !found; start++) {
      const walk = (node, depth, path) => {
        if (found) return;
        if (depth === 6) {
          if (node === start) found = true;
          return;
        }
        for (const nb of adj[node]) {
          if (nb === start && depth === 5) return void (found = true);
          if (!path.includes(nb)) walk(nb, depth + 1, [...path, nb]);
        }
      };
      walk(start, 0, [start]);
    }
    expect(found).toBe(true);
  });

  it('obeys the ice rules: exactly one hydrogen on every O···O link', () => {
    const count = new Map();
    for (const { from, to } of lat.links) {
      const key = [Math.min(from, to), Math.max(from, to)].join('-');
      count.set(key, (count.get(key) || 0) + 1);
    }
    let links = 0;
    lat.sites.forEach((s, u) => s.neighbors.forEach((v) => {
      if (v > u) {
        links++;
        expect(count.get(`${u}-${v}`)).toBe(1);
      }
    }));
    expect(lat.links).toHaveLength(links);
  });

  it('obeys the ice rules: every oxygen donates two hydrogens and accepts at most two', () => {
    const accepts = new Array(40).fill(0);
    for (const { to } of lat.links) accepts[to]++;
    lat.sites.forEach((s, i) => {
      expect(s.donors).toHaveLength(2);
      expect(new Set(s.donors).size).toBe(2);
      expect(accepts[i]).toBeLessThanOrEqual(2);
    });
  });

  it('target orientations point each O–H along its donor direction (within 3°)', () => {
    const half = (HOH_ANGLE / 2) / DEG;
    const h1 = [-Math.sin(half), -Math.cos(half), 0];
    const h2 = [Math.sin(half), -Math.cos(half), 0];
    for (const s of lat.sites) {
      const a = quat.rotate(s.quat, h1);
      const b = quat.rotate(s.quat, h2);
      expect(v3.angle(a, s.dirs[s.donors[0]]) * DEG).toBeLessThan(3);
      expect(v3.angle(b, s.dirs[s.donors[1]]) * DEG).toBeLessThan(3);
      expect(v3.angle(a, b) * DEG).toBeCloseTo(104.5, 4);
    }
  });
});

describe('water simulation', () => {
  it('uses the real water geometry', () => {
    const sim = new WaterSim({ count: 8 });
    expect(v3.angle(sim.h1, sim.h2) * DEG).toBeCloseTo(104.5, 6);
    expect(OH_RATIO).toBeCloseTo(0.9572 / 2.76, 9);
  });

  it('phase follows temperature with hysteresis', () => {
    expect(phaseFor(-20, 'LIQUID')).toBe('ICE');
    expect(phaseFor(25, 'ICE')).toBe('LIQUID');
    expect(phaseFor(130, 'LIQUID')).toBe('GAS');
    expect(phaseFor(50, 'GAS')).toBe('LIQUID');
    expect(phaseFor(1, 'ICE')).toBe('ICE'); // not yet past the hysteresis band
    expect(phaseFor(-1, 'LIQUID')).toBe('LIQUID');
    expect(phaseFor(99, 'GAS')).toBe('GAS');
    expect(phaseFor(140, 'ICE')).toBe('GAS');
    expect(phaseFor(-30, 'GAS')).toBe('ICE');
  });

  it('stays finite and inside the chamber across all three phases', () => {
    const sim = new WaterSim({ count: 40 });
    const run = (temp, seconds) => {
      sim.setTemperature(temp);
      for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60);
    };
    for (const t of [25, 140, 25, -40]) {
      run(t, 4);
      for (let i = 0; i < sim.pos.length; i++) {
        expect(Number.isFinite(sim.pos[i])).toBe(true);
        expect(Math.abs(sim.pos[i])).toBeLessThan(sim.box[i % 3] + 1.2);
      }
    }
  });

  it('freezes into the lattice: cold molecules settle on their sites with ~4 H-bonds each', () => {
    const sim = new WaterSim({ count: 40 });
    sim.setTemperature(-40);
    for (let i = 0; i < 9 * 60; i++) sim.step(1 / 60);
    expect(sim.phase).toBe('ICE');
    let err = 0;
    for (let i = 0; i < sim.n; i++) {
      const s = sim.lattice.sites[sim.site[i]].pos;
      err += Math.hypot(sim.pos[i * 3] - s[0], sim.pos[i * 3 + 1] - s[1], sim.pos[i * 3 + 2] - s[2]);
    }
    expect(err / sim.n).toBeLessThan(0.12 * sim.d);
    // each real lattice link should now be an H-bond found by the force model
    expect(sim.hbondCount).toBeGreaterThanOrEqual(sim.lattice.links.length * 0.9);
  });

  it('gas has (almost) no hydrogen bonds and fills the chamber', () => {
    const sim = new WaterSim({ count: 40 });
    sim.setTemperature(150);
    for (let i = 0; i < 6 * 60; i++) sim.step(1 / 60);
    expect(sim.phase).toBe('GAS');
    expect(sim.hbondCount).toBeLessThan(4);
    let meanY = 0;
    for (let i = 0; i < sim.n; i++) meanY += sim.pos[i * 3 + 1];
    expect(Math.abs(meanY / sim.n)).toBeLessThan(sim.box[1] * 0.5); // no longer pooled at the bottom
  });

  it('liquid is denser than ice (molecules closer together on average)', () => {
    const nearest = (sim) => {
      let sum = 0;
      for (let i = 0; i < sim.n; i++) {
        const ds = [];
        for (let j = 0; j < sim.n; j++) {
          if (i === j) continue;
          ds.push(Math.hypot(sim.pos[i * 3] - sim.pos[j * 3], sim.pos[i * 3 + 1] - sim.pos[j * 3 + 1], sim.pos[i * 3 + 2] - sim.pos[j * 3 + 2]));
        }
        ds.sort((a, b) => a - b);
        sum += (ds[0] + ds[1] + ds[2] + ds[3] + ds[4] + ds[5]) / 6; // mean distance to the six nearest
      }
      return sum / sim.n;
    };
    const liquid = new WaterSim({ count: 40 });
    liquid.setTemperature(40);
    for (let i = 0; i < 8 * 60; i++) liquid.step(1 / 60);
    const ice = new WaterSim({ count: 40 });
    ice.setTemperature(-40);
    for (let i = 0; i < 9 * 60; i++) ice.step(1 / 60);
    expect(nearest(liquid)).toBeLessThan(nearest(ice));
  });
});

describe('math helpers', () => {
  it('orientationFor maps the two O–H bonds symmetrically about the donor bisector', () => {
    const dA = v3.norm([1, 1, 0]);
    const dB = v3.norm([-1, 1, 0]);
    const q = orientationFor(dA, dB);
    const bis = quat.rotate(q, [0, -1, 0]);
    expect(v3.angle(bis, [0, 1, 0]) * DEG).toBeLessThan(1e-4);
  });

  it('bestFitRotation recovers a known rotation', () => {
    const pts = [[1, 0, 0], [0, 2, 0], [0, 0, 3], [-1, -1, 0.5], [0.3, -0.7, -1.2]];
    const c = pts.reduce((a, p) => v3.add(a, p), [0, 0, 0]).map((x) => x / pts.length);
    const from = pts.map((p) => v3.sub(p, c));
    const q = quat.norm([0.3, -0.5, 0.2, 0.79]);
    const to = from.map((p) => quat.rotate(q, p));
    const r = bestFitRotation(from, to);
    from.forEach((p, i) => {
      const got = quat.rotate(r, p);
      expect(v3.len(v3.sub(got, to[i]))).toBeLessThan(1e-4);
    });
  });

  it('bestFitRotation handles two-point (degenerate) sets', () => {
    const from = [[-0.5, 0, 0], [0.5, 0, 0]];
    const to = [[0, -0.5, 0], [0, 0.5, 0]];
    const r = bestFitRotation(from, to);
    expect(v3.len(v3.sub(quat.rotate(r, from[1]), to[1]))).toBeLessThan(1e-3);
  });

  it('One Euro filter smooths jitter but follows fast motion', () => {
    const still = new OneEuro(1.2, 10, 1);
    let out = 0;
    for (let i = 0; i < 120; i++) out = still.filter(0.5 + (i % 2 ? 0.004 : -0.004), 1 / 30);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.0025); // jitter attenuated
    const moving = new OneEuro(1.2, 10, 1);
    let x = 0;
    for (let i = 0; i < 30; i++) {
      x = i / 30;
      out = moving.filter(x, 1 / 30);
    }
    expect(Math.abs(out - x)).toBeLessThan(0.03); // small lag at 1 unit/s
  });
});
