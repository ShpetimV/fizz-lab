import * as THREE from 'three';
import { BubbleSim } from './sim.js';
import { BubbleView } from './view.js';
import { filmColor } from './film.js';
import { PART } from '../render/batches.js';
import { LM, FINGERTIPS } from '../gestures/gestures.js';
import { COL, VIEW, DEPTH } from '../config.js';
import { clamp, damp } from '../core/math.js';

const _v = new THREE.Vector3();
const arr = (v) => [v.x, v.y, v.z];

export const BUBBLE_FACTS = {
  colours: 'A soap film is only a few hundred nanometres thick, close to the wavelength of light. Light reflected from its front and its back surfaces overlaps: some colours add up and others cancel, and which ones depends on the thickness.',
  drain: 'Gravity drains the film downward, so it thins from the top, and the colour bands slide as it does.',
  black: 'When the film gets much thinner than the wavelength of light, the two reflections cancel, the film turns nearly invisible, and the bubble is about to burst.',
  round: 'A bubble is round because surface tension pulls the film into the smallest surface that can hold the air inside, and that shape is a sphere.',
};

/** Soap bubbles: blow them with a pinch, wave them along, poke them. */
export class BubbleLab {
  constructor({ stage, fx, sfx, tell, aside }) {
    this.stage = stage;
    this.fx = fx;
    this.sfx = sfx;
    this.tell = tell;
    this.aside = aside;
    this.sim = new BubbleSim();
    this.view = new BubbleView(stage);
    this.blowing = new Map(); // pointer -> bubble being blown
    this.streamClock = new Map(); // pointer -> seconds until the next streamed bubble
    this.alpha = 0;
    this.said = new Set();
    this.best = 0; // longest a bubble has lasted
    this.touchPops = 0;
  }

  once(key, fn) {
    if (this.said.has(key)) return;
    this.said.add(key);
    fn();
  }

  enter() {
    if (!this.sim.bubbles.length) {
      // a few to start with, so there is something to poke
      for (let i = 0; i < 5; i++) {
        this.sim.blow([(i - 2) * 1.4 + (Math.random() - 0.5) * 0.4, -0.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2], { r: 0.3 + Math.random() * 0.35 });
      }
    }
  }

  exit() {
    for (const [p, b] of this.blowing) this.sim.release(b, arr(p.vel));
    this.blowing.clear();
  }

  popAll() {
    for (const b of [...this.sim.bubbles]) this.sim.burst(b, 'touch');
  }

  update(dt, time, pointers, active) {
    this.alpha += ((active ? 1 : 0) - this.alpha) * damp(6, dt);
    if (!active && this.blowing.size) this.exit();
    if (!active && this.alpha < 0.01) {
      this.view.mesh.visible = false;
      return;
    }
    const sim = this.sim;
    const stage = this.stage;
    sim.bounds = { x: stage.halfW - 0.4, yMin: -VIEW.halfH + 0.6, yMax: VIEW.halfH - 0.3, z: 2.4 };
    const wind = [];
    const pokers = [];
    if (active) {
      for (const p of pointers) {
        const blown = this.blowing.get(p);
        if (!p.active) {
          if (blown) {
            sim.release(blown);
            this.blowing.delete(p);
          }
          continue;
        }
        const at = p.pos;
        if (p.pinchDown && !blown) {
          const hit = sim.at(arr(at), 0.05);
          if (hit) {
            sim.burst(hit, 'touch');
          } else {
            const b = sim.blow(arr(at), { held: true });
            this.blowing.set(p, b);
            this.sfx.blow(0.2);
            this.once('blow', () => this.aside('Keep holding and it grows. Let go to set it free.', 4, {
              event: 'The player started blowing a soap bubble.',
              facts: BUBBLE_FACTS.round,
            }));
          }
        }
        const b = this.blowing.get(p);
        if (b) {
          if (p.pinch && sim.bubbles.includes(b)) {
            b.p = arr(at);
            if (b.r >= 0.84) {
              // full size: it lets go on its own
              sim.release(b, arr(p.vel));
              this.blowing.delete(p);
              this.sfx.blow(b.r);
            }
          } else {
            sim.release(b, arr(p.vel));
            this.blowing.delete(p);
            this.sfx.blow(b.r);
          }
        }
        if (p.kind === 'hand') {
          // fingertips pop, a moving hand makes wind, a fast open hand streams new bubbles
          for (const tip of FINGERTIPS) {
            if (p.pinch && (tip === LM.THUMB_TIP || tip === LM.INDEX_TIP)) continue;
            pokers.push({ p: arr(p.joints[tip]), r: 0.07 });
          }
          if (p.palmVel.length() > 1.2) wind.push({ p: arr(p.palm), v: arr(p.palmVel), r: 1.6 });
          const left = (this.streamClock.get(p) || 0) - dt;
          if (p.open && !p.pinch && p.palmVel.length() > 3 && left <= 0) {
            const speed = p.palmVel.length();
            _v.copy(p.palm).addScaledVector(p.palmVel, 0.06);
            sim.blow(arr(_v), { r: clamp(0.5 - speed * 0.03, 0.14, 0.42), v: arr(p.palmVel).map((x) => x * 0.3) });
            this.sfx.blow(0.3);
            this.streamClock.set(p, 0.16);
          } else this.streamClock.set(p, left);
        } else if (!p.pinch && p.vel.length() > 2.5) {
          wind.push({ p: arr(p.pos), v: arr(p.vel), r: 1.2 });
        }
      }
    }
    sim.wind = wind;
    sim.pokers = pokers;
    for (const e of sim.step(dt * (active ? 1 : 0))) this.onPop(e);
    this.view.update(sim, this.alpha);
  }

  onPop(e) {
    const [x, y, z] = e.p;
    this.sfx.pop(e.r);
    this.best = Math.max(this.best, e.age);
    // the film tears and flies off as a ring of tiny droplets
    const ps = this.fx.particles;
    for (let i = 0, n = ps.n(18 + e.r * 40); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - c * c);
      const dx = Math.cos(a) * s;
      const dy = c;
      const dz = Math.sin(a) * s;
      ps.emit(x + dx * e.r, y + dy * e.r, z + dz * e.r, dx * 1.1, dy * 1.1 - 0.3, dz * 1.1, 0.45 + Math.random() * 0.3, PART.BURST, [0.92, 0.96, 1], 0.03);
    }
    this.fx.ring(_v.set(x, y, z), e.r * 2.4, COL.white, 0.22);
    if (e.cause === 'touch') {
      this.touchPops++;
      if (this.touchPops === 4) {
        this.aside('You do enjoy popping things.', 10, { event: 'The player has been popping soap bubbles with their fingers.', facts: BUBBLE_FACTS.round });
      }
    } else if (e.cause === 'thin') {
      this.once('thin', () => this.tell('That one burst by itself. Just before it went, the top turned dark: the film had drained too thin to reflect any colour.', {
        event: 'A soap bubble burst on its own after its film drained away.',
        facts: `${BUBBLE_FACTS.drain} ${BUBBLE_FACTS.black}`,
        priority: true,
      }));
    }
  }

  coach(cam) {
    if (!this.sim.bubbles.length) return cam ? 'Pinch in the air to blow a bubble; open your fingers to let it go.' : 'Press and hold to blow a bubble, release to let it go.';
    return cam
      ? 'Pinch and hold to blow a bubble. Wave a flat hand to blow them along, or to stream new ones. Poke them with a fingertip.'
      : 'Hold the mouse button to blow a bubble, release to let go. Click a bubble to pop it. Fast mouse moves make wind.';
  }

  /** What the side panel shows: thickness at the top of each bubble (nm). */
  panel() {
    return {
      popped: this.sim.popped,
      alive: this.sim.bubbles.length,
      best: this.best,
      films: this.sim.bubbles.map((b) => this.sim.thickness(b)),
    };
  }

  describe() {
    return `The player is in the bubble lab with ${this.sim.bubbles.length} soap bubbles floating. ${this.sim.popped} have burst so far. ${BUBBLE_FACTS.colours} ${BUBBLE_FACTS.black}`;
  }
}

/** Draw the thickness → colour chart into a canvas (used by the HUD). */
export function drawFilmChart(canvas, maxNm = 1000) {
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = g.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const c = filmColor((x / (w - 1)) * maxNm);
    // brighten for display: the film itself only reflects a few percent
    const k = 1.15;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, Math.pow(c[0] * k, 0.8) * 255);
      img.data[i + 1] = Math.min(255, Math.pow(c[1] * k, 0.8) * 255);
      img.data[i + 2] = Math.min(255, Math.pow(c[2] * k, 0.8) * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
