import { describe, it, expect } from 'vitest';
import { filmColor, SPECTRUM } from '../src/bubbles/film.js';
import { BubbleSim, BUBBLES } from '../src/bubbles/sim.js';

const run = (sim, seconds) => {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...sim.step(1 / 60));
  return events;
};

describe('thin-film colour', () => {
  it('a film far thinner than light reflects almost nothing (black film)', () => {
    const c = filmColor(5);
    expect(Math.max(...c)).toBeLessThan(0.01);
  });

  it('reflection grows as the film thickens toward a quarter wavelength', () => {
    const lum = (c) => c[0] + c[1] + c[2];
    expect(lum(filmColor(40))).toBeGreaterThan(lum(filmColor(10)));
    expect(lum(filmColor(100))).toBeGreaterThan(lum(filmColor(40)));
  });

  it('first-order colours: about 100 nm looks white-grey, mid-hundreds look strongly coloured', () => {
    const spread = (c) => Math.max(...c) - Math.min(...c);
    const c100 = filmColor(100);
    expect(spread(c100) / Math.max(...c100)).toBeLessThan(0.5);
    // somewhere in 250–600 nm the film is vividly coloured
    let vivid = 0;
    for (let d = 250; d <= 600; d += 10) {
      const c = filmColor(d);
      vivid = Math.max(vivid, spread(c) / Math.max(...c));
    }
    expect(vivid).toBeGreaterThan(0.8);
  });

  it('a very thick film washes out toward white (colours overlap)', () => {
    const c = filmColor(6000);
    const spread = Math.max(...c) - Math.min(...c);
    expect(spread).toBeLessThan(0.25);
  });

  it('the spectrum table is normalised: full reflection everywhere gives white', () => {
    for (let k = 1; k <= 3; k++) expect(SPECTRUM.reduce((s, row) => s + row[k], 0)).toBeCloseTo(1, 6);
  });

  it('tilting the film shifts the colour (the path through it gets shorter)', () => {
    const a = filmColor(350, 1);
    const b = filmColor(350, 0.3);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeGreaterThan(0.1);
  });
});

describe('bubbles', () => {
  it('a bubble being blown grows, and stops at the maximum size', () => {
    const sim = new BubbleSim();
    const b = sim.blow([0, 0, 0], { held: true });
    run(sim, 1);
    expect(b.r).toBeGreaterThan(0.3);
    run(sim, 10);
    expect(b.r).toBeLessThanOrEqual(BUBBLES.MAX_R);
    expect(sim.bubbles).toContain(b);
  });

  it('the film thins with age and the bubble bursts when it is gone', () => {
    const sim = new BubbleSim();
    const b = sim.blow([0, 0, 0], { r: 0.4 });
    const start = sim.thickness(b);
    run(sim, b.life * 0.5);
    expect(sim.thickness(b)).toBeLessThan(start);
    const events = run(sim, b.life);
    expect(events).toEqual([expect.objectContaining({ type: 'pop', cause: 'thin' })]);
    expect(sim.bubbles).toHaveLength(0);
    expect(sim.popped).toBe(1);
  });

  it('sinks slowly in still air', () => {
    const sim = new BubbleSim();
    const b = sim.blow([0, 0, 0], { r: 0.3 });
    run(sim, 4);
    expect(b.p[1]).toBeLessThan(0);
    expect(b.p[1]).toBeGreaterThan(-2);
  });

  it('a fingertip bursts it, but not a newborn or one still being blown', () => {
    const sim = new BubbleSim();
    const held = sim.blow([0, 0, 0], { r: 0.3, held: true });
    const free = sim.blow([2, 0, 0], { r: 0.3 });
    sim.pokers = [{ p: [0, 0, 0], r: 0.05 }, { p: [2, 0, 0], r: 0.05 }];
    expect(run(sim, 0.1)).toHaveLength(0); // newborn grace
    const events = run(sim, 0.5);
    expect(events.map((e) => e.cause)).toEqual(['touch']);
    expect(sim.bubbles).toEqual([held]);
    expect(sim.bubbles).not.toContain(free);
  });

  it('a moving hand blows bubbles along', () => {
    const sim = new BubbleSim();
    const b = sim.blow([0, 0, 0], { r: 0.3 });
    sim.wind = [{ p: [-0.5, 0, 0], v: [4, 0, 0], r: 1.5 }];
    run(sim, 0.5);
    expect(b.p[0]).toBeGreaterThan(0.3);
  });

  it('never holds more than the maximum: the oldest makes room', () => {
    const sim = new BubbleSim();
    for (let i = 0; i < BUBBLES.MAX + 5; i++) sim.blow([i * 0.1, 0, 0], { r: 0.1 });
    expect(sim.bubbles.length).toBe(BUBBLES.MAX);
  });
});
