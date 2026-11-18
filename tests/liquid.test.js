import { describe, it, expect } from 'vitest';
import { LiquidSim } from '../src/liquid/sim.js';

const run = (sim, seconds, each = () => {}) => {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    each(t);
    events.push(...sim.step(1 / 60));
  }
  return events;
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('liquid metal', () => {
  it('rests as a single droplet at home', () => {
    const sim = new LiquidSim();
    run(sim, 4);
    expect(sim.drops.length).toBe(1);
    expect(dist(sim.drops[0].centre, sim.home)).toBeLessThan(0.25);
    for (const c of sim.cells) expect(c.p.every(Number.isFinite)).toBe(true);
  });

  it('stays compact: no cell wanders off on its own', () => {
    const sim = new LiquidSim();
    run(sim, 6);
    const b = sim.bounds3();
    expect(b.radius).toBeLessThan(1.6);
  });

  it('pulling one cell far away tears off a droplet', () => {
    const sim = new LiquidSim();
    run(sim, 2);
    const i = sim.pick([sim.home[0] + 3, sim.home[1], 0], 5);
    sim.grab(i, sim.cells[i].p);
    const events = run(sim, 2.5, (t) => sim.move(i, [sim.home[0] + Math.min(4, t * 3), sim.home[1], 0]));
    expect(sim.drops.length).toBeGreaterThan(1);
    expect(events.some((e) => e.type === 'split')).toBe(true);
    // the main body did not follow the hand all the way
    expect(dist(sim.drops[sim.main].centre, sim.home)).toBeLessThan(1.6);
  });

  it('a released droplet drifts back and merges', () => {
    const sim = new LiquidSim();
    run(sim, 2);
    const i = sim.pick([sim.home[0] + 3, sim.home[1], 0], 5);
    sim.grab(i, sim.cells[i].p);
    run(sim, 2.5, (t) => sim.move(i, [sim.home[0] + Math.min(4, t * 3), sim.home[1], 0]));
    expect(sim.drops.length).toBeGreaterThan(1);
    sim.release(i);
    const events = run(sim, 10);
    expect(events.some((e) => e.type === 'merge')).toBe(true);
    expect(sim.drops.length).toBe(1);
  });

  it('a splash scatters it into several droplets, which come back together', () => {
    const sim = new LiquidSim();
    run(sim, 2);
    expect(sim.splash(sim.drops[0].centre, [0, 0, 0], 2, 1.4)).toBeGreaterThan(8);
    run(sim, 0.6);
    expect(sim.drops.length).toBeGreaterThanOrEqual(3);
    run(sim, 14);
    expect(sim.drops.length).toBeLessThanOrEqual(2);
  });

  it('a magnet pulls the body toward it', () => {
    const sim = new LiquidSim();
    run(sim, 2);
    const start = sim.drops[sim.main].centre[0];
    sim.magnet = { p: [sim.home[0] + 3, sim.home[1], 0], strength: 1 };
    run(sim, 2);
    expect(sim.drops[sim.main].centre[0]).toBeGreaterThan(start + 0.4);
    for (const c of sim.cells) expect(c.p.every(Number.isFinite)).toBe(true);
  });

  it('a fingertip pressed into the side clears the liquid out from under it', () => {
    const sim = new LiquidSim();
    run(sim, 2);
    const [cx, cy, cz] = sim.drops[0].centre;
    const r = sim.bounds3().radius;
    const at = [cx + r - 0.3, cy, cz]; // 0.3 inside the right-hand surface
    const near = () => Math.min(...sim.cells.map((cell) => dist(cell.p, at) - cell.r * 0.8));
    const before = near();
    sim.pokes = [{ p: at, r: 0.2 }];
    run(sim, 1);
    expect(near()).toBeGreaterThan(Math.max(before, 0.2 - 0.1));
    expect(sim.drops.length).toBe(1); // a gentle touch does not tear it
  });

  it('pours in one cell after another and ends as one droplet', () => {
    const sim = new LiquidSim();
    sim.pour([0, 2.6, 0]);
    expect(sim.drops.length).toBe(0);
    run(sim, 0.4);
    const partial = sim.cells.filter((c) => sim.active(c)).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(sim.n);
    run(sim, 8);
    expect(sim.drops.length).toBe(1);
  });

  it('survives rough input without blowing up', () => {
    const sim = new LiquidSim();
    run(sim, 1);
    const i = sim.pick(sim.drops[0].centre, 5);
    sim.grab(i, sim.cells[i].p);
    run(sim, 3, (t) => {
      sim.move(i, [Math.sin(t * 40) * 5, Math.cos(t * 33) * 3, 0]);
      if (Math.floor(t * 10) % 7 === 0) sim.splash([0, 0, 0], [20, -20, 5], 3, 2);
    });
    sim.release(i, [50, 50, 50]);
    run(sim, 2);
    for (const c of sim.cells) {
      expect(c.p.every(Number.isFinite)).toBe(true);
      expect(Math.abs(c.p[0])).toBeLessThan(10);
    }
  });
});
