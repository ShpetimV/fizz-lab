import * as THREE from 'three';
import { LiquidSim } from './sim.js';
import { LiquidView } from './view.js';
import { MATERIALS, materialById } from './materials.js';
import { swatchItem } from '../render/strip.js';
import { LM } from '../gestures/gestures.js';
import { COL, VIEW, DEPTH } from '../config.js';
import { clamp, damp } from '../core/math.js';

const HOME = [0, -0.45, 0];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const arr = (v) => [v.x, v.y, v.z];

/**
 * The liquid metal toy: wires hands and mouse into the liquid simulation,
 * picks materials from the dock, and turns what happens into sound, effects
 * and narration.
 */
export class LiquidLab {
  /**
   * @param tell   (canned, opts) narrate something now
   * @param aside  (canned, gap, opts) narrate only if the narrator is idle
   */
  constructor({ stage, dock, fx, sfx, tell, aside }) {
    this.stage = stage;
    this.dock = dock;
    this.fx = fx;
    this.sfx = sfx;
    this.tell = tell;
    this.aside = aside;
    this.sim = new LiquidSim({ home: HOME });
    this.view = new LiquidView(stage);
    this.material = MATERIALS[0];
    this.look = { tint: [...this.material.tint], metal: 1, rough: 0, heat: 0 };
    this.grips = new Map(); // pointer -> { cell, dz }
    this.magnet = { p: [0, 0, 0], amount: 0 };
    this.splashCool = 0;
    this.scale = 0;
    this.alpha = 0;
    this.pokes = [];
    this.palmNear = false;
    this.said = new Set();
    this.stats = { splits: 0, merges: 0, splashes: 0 };
    this.entered = false;
  }

  get droplets() {
    return this.sim.drops.length;
  }

  once(key, fn) {
    if (this.said.has(key)) return;
    this.said.add(key);
    fn();
  }

  enter() {
    this.dock.setItems(MATERIALS.map((m) => swatchItem({ id: m.id, name: m.name, sub: m.sub, color: m.swatch })));
    this.markDock();
    this.refill();
    this.entered = true;
  }

  exit() {
    for (const [, g] of this.grips) this.sim.release(g.cell);
    this.grips.clear();
  }

  /** Pour a fresh batch in from the dock. */
  refill() {
    const top = this.dock.tiles[0] ? this.dock.tiles[0].y - this.dock.size * 0.8 : 2.4;
    this.sim.pour([0, Math.min(top, VIEW.halfH - 1.6), 0]);
    this.sfx.pour(this.sim.n);
    this.scale = 1;
  }

  markDock() {
    for (const t of this.dock.tiles) t.selected = t.id === this.material.id;
  }

  setMaterial(id) {
    const m = materialById(id);
    if (m === this.material) return;
    this.material = m;
    this.markDock();
    this.sfx.swish();
    // a shiver runs through the liquid as it changes
    for (const c of this.sim.cells) {
      c.v[0] += (Math.random() - 0.5) * 1.2;
      c.v[1] += (Math.random() - 0.5) * 1.2;
    }
    const b = this.sim.bounds3();
    if (b) this.fx.shockwave(_v.set(...b.centre));
    this.tell(m.fact, {
      event: `The player switched the liquid to ${m.name.toLowerCase()}.`,
      facts: m.fact,
      priority: true,
      key: 'material',
    });
  }

  /** Cell under a pointer, judged on screen (so depth does not have to match exactly). */
  pickCell(p) {
    const stage = this.stage;
    let best = -1;
    let bestScore = 0.3;
    this.sim.cells.forEach((c, i) => {
      if (!this.sim.active(c)) return;
      stage.project(_v.set(...c.p), _w);
      const d = Math.hypot((_w.x - p.nx) * stage.halfW, (_w.y - p.ny) * VIEW.halfH);
      const score = d - c.r * _w.z;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  nearBody(pos, margin = 0.4) {
    const b = this.sim.bounds3();
    return b && Math.hypot(pos.x - b.centre[0], pos.y - b.centre[1], pos.z - b.centre[2]) < b.radius + margin;
  }

  update(dt, time, pointers, active) {
    this.alpha += ((active ? 1 : 0) - this.alpha) * damp(active ? 5 : 8, dt);
    if (!active) {
      if (this.grips.size) this.exit();
      if (this.alpha < 0.01) return this.view.hide();
    }
    const sim = this.sim;
    const stage = this.stage;
    sim.bounds = { x: stage.halfW - 1.4, yMin: -VIEW.halfH + 1.1, yMax: VIEW.halfH - 2.1, z: 2.4 };
    this.splashCool = Math.max(0, this.splashCool - dt);

    // the look glides from one material to the next
    const m = this.material;
    const k = damp(4, dt);
    for (let i = 0; i < 3; i++) this.look.tint[i] += (m.tint[i] - this.look.tint[i]) * k;
    this.look.metal += (m.metal - this.look.metal) * k;
    this.look.rough += (m.rough - this.look.rough) * k;
    this.look.heat += (m.heat - this.look.heat) * k;

    const pokes = [];
    let palm = null;
    if (active) {
      for (const p of pointers) {
        const grip = this.grips.get(p);
        if (!p.active) {
          if (grip) {
            sim.release(grip.cell);
            this.grips.delete(p);
          }
          continue;
        }
        // the dock: pick a material
        if (p.pinchDown && !grip) {
          const tile = this.dock.hit(p.nx, p.ny);
          if (tile) {
            tile.flash = 1;
            this.setMaterial(tile.id);
            continue;
          }
          const cell = this.pickCell(p);
          if (cell >= 0) {
            const c = sim.cells[cell];
            this.grips.set(p, { cell, dz: c.p[2] - p.z });
            sim.grab(cell, c.p);
            this.sfx.pinch();
          }
        }
        const g = this.grips.get(p);
        if (g) {
          if (p.pinch) sim.move(g.cell, arr(stage.unproject(p.nx, p.ny, clamp(p.z + g.dz, DEPTH.min, DEPTH.max), _v)));
          else {
            sim.release(g.cell, arr(p.vel));
            this.grips.delete(p);
            this.sfx.release();
          }
        }
        // fingertips (or the idle cursor) press dimples into the surface
        if (p.kind === 'hand') {
          if (!p.pinch && !p.open) {
            for (const tip of [LM.INDEX_TIP, LM.THUMB_TIP]) if (this.nearBody(p.joints[tip], 0.2)) pokes.push({ p: arr(p.joints[tip]), r: 0.13 });
          }
        } else if (!p.pinch && !p.rotate && this.nearBody(p.pos, 0.2)) pokes.push({ p: arr(p.pos), r: 0.15 });

        // an open palm (right mouse button): magnet for ferrofluid, a gentle push for the others
        const open = p.kind === 'hand' ? p.open && !p.pinch : !!p.rotate;
        if (open) {
          const at = p.kind === 'hand' ? p.palm : p.pos;
          const b = sim.bounds3();
          const d = b ? Math.hypot(at.x - b.centre[0], at.y - b.centre[1], at.z - b.centre[2]) - b.radius : 99;
          if (!palm || d < palm.d) palm = { p: arr(at), d };
        }
        // a fast swipe of the flat hand through the liquid, or a double-click: splash
        const swipe = p.kind === 'hand' && p.open && !p.pinch && p.palmVel.length() > 8.5 && this.nearBody(p.palm, 0.2);
        const click = p.kind !== 'hand' && p.breakNow && this.nearBody(p.pos, 0.3);
        if ((swipe || click) && this.splashCool <= 0) {
          const at = swipe ? p.palm : p.pos;
          sim.splash(arr(at), swipe ? arr(p.palmVel).map((x) => x * 0.25) : [0, 0, 0], 2.4, 1.15);
          this.splashCool = 0.8;
          this.stats.splashes++;
          this.sfx.splash();
          this.fx.shockwave(at);
          this.once('splash', () => this.aside('Splashed into droplets. Give them a moment: they find each other again.', 6, {
            event: `The player splashed the ${m.name.toLowerCase()} apart into droplets.`,
            facts: 'The droplets drift back together and merge, because one big drop has less surface than several small ones, and surface tension always pulls toward less surface.',
          }));
        }
      }
    }

    // magnet / palm push
    let target = 0;
    if (palm && palm.d < 3.2) {
      if (m.magnetic) {
        target = clamp(1.25 - palm.d / 3.2, 0, 1);
        this.magnet.p = palm.p;
        this.once('magnet', () => this.tell('Spikes. The magnetic pull drags the fluid toward your hand, and surface tension fights it. Where they balance, the surface stands up in points.', {
          event: 'The player held an open hand over the ferrofluid like a magnet, and it rose into spikes.',
          facts: 'In a magnetic field ferrofluid forms spikes: the field pulls the fluid along its lines while surface tension and gravity resist, and the surface settles into a regular pattern of peaks.',
          priority: true,
        }));
      } else if (palm.d < 0.5) {
        pokes.push({ p: palm.p, r: 0.36 });
        this.once(`nomagnet-${m.id}`, () => this.aside(`${m.name} is not magnetic, so your hand just pushes it. Try the ferrofluid for that trick.`, 4, {
          event: `The player held an open hand over the ${m.name.toLowerCase()} as if it were a magnet. Nothing magnetic happened.`,
          facts: `${m.name} is not magnetic, so a magnet does nothing to it. Of the liquids here only the ferrofluid responds to a magnet.`,
        }));
      }
    }
    this.magnet.amount += (target - this.magnet.amount) * damp(target > this.magnet.amount ? 3 : 5, dt);
    sim.magnet = this.magnet.amount > 0.01 ? { p: this.magnet.p, strength: this.magnet.amount } : null;
    sim.pokes = pokes;
    this.pokes = pokes;

    for (const e of active ? sim.step(dt) : []) {
      _v.set(...e.p);
      if (e.type === 'split') {
        this.stats.splits++;
        this.sfx.tear(e.size);
        this.once('split', () => this.aside('You pulled a droplet off. See how it snaps round at once.', 5, {
          event: `The player pulled a droplet off the ${m.name.toLowerCase()}.`,
          facts: 'Surface tension pulls a liquid into the smallest surface it can have, and for a small droplet that shape is a sphere.',
        }));
      } else {
        this.stats.merges++;
        this.sfx.plip(e.size);
        if (this.stats.merges === 3) {
          this.aside('They always find their way back. One big drop has less surface than two small ones, and liquids prefer less surface.', 8, {
            event: 'Separate droplets of liquid metal flowed back together and merged.',
            facts: 'When two droplets touch they merge, because one bigger drop has less total surface than two small ones, and surface tension always pulls toward less surface.',
          });
        }
      }
    }

    // molten gold sheds the odd spark
    if (active && this.look.heat > 0.5 && Math.random() < dt * 5) {
      const c = sim.cells[(Math.random() * sim.n) | 0];
      if (sim.active(c)) {
        _v.set(c.p[0], c.p[1] + c.r * 0.8, c.p[2]);
        this.fx.particles.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.2, 0, 1.2, 0, COL.hot, 0.035);
      }
    }

    this.view.update({
      sim,
      look: this.look,
      pokes,
      magnet: this.magnet,
      scale: this.scale,
      alpha: this.alpha,
      steps: stage.qualityKey === 'high' ? 110 : 64,
    });
  }

  /** The line for the coach strip. */
  coach(cam) {
    const m = this.material;
    if (m.magnetic) {
      return cam
        ? 'Hold an open hand above the ferrofluid and it reaches for you in spikes. Pinch to pull pieces off.'
        : 'Hold the right mouse button near the ferrofluid: it reaches for the cursor in spikes. Drag to pull pieces off.';
    }
    if (this.droplets > 1) return 'Droplets drift back and merge on their own. Pinch the dock above to change the liquid.';
    return cam
      ? 'Pinch the liquid and pull to tear off a droplet. Poke it with a finger. Swipe a flat hand through it to splash.'
      : 'Drag the liquid to pull droplets off. Hover to dent it. Double-click to splash. Pick a liquid from the dock.';
  }

  /** What the side panel shows. */
  panel() {
    const m = this.material;
    return { id: m.id, name: m.name, sub: m.sub, temp: m.temp, fact: m.fact, droplets: this.droplets };
  }

  /** Plain-language snapshot for spoken questions. */
  describe() {
    const m = this.material;
    return `The player is in the liquid metal lab, playing with ${m.name.toLowerCase()} (${m.temp}). It is currently in ${this.droplets} droplet${this.droplets === 1 ? '' : 's'}. ${m.fact}`;
  }
}
