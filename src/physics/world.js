import * as THREE from 'three';
import {
  ChemGraph, ELEMENTS, CATALOG, identify, layoutMolecule, bondLength, rejectionText,
} from '../chemistry/index.js';
import { bestFitRotation, clamp, damp, easeOutBack, easeInOut } from '../core/math.js';
import { BEAM, BB, glyphIndex, labelAnchor } from '../render/batches.js';
import { COL, VIEW, DEPTH } from '../config.js';

const MAX_ATOMS = 40;
const BOND_REACH = 0.58; // extra distance beyond touching shells at which atoms react
const ARC_TIME = 0.36; // lightning anticipation before a bond snaps
const CO_SETTLE = 2.6; // seconds a lone C=O waits before closing to carbon monoxide

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

let bodySeq = 1;

/** A rigid fragment: one atom, a radical, or a finished molecule. */
class Body {
  constructor(pos) {
    this.id = bodySeq++;
    this.atoms = [];
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.base = new THREE.Quaternion(); // orientation without the idle wobble
    this.quat = new THREE.Quaternion(); // orientation actually displayed
    this.spin = new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.3);
    this.local = new Map(); // atom id -> current offset in body space
    this.target = new Map(); // atom id -> VSEPR offset it is relaxing toward
    this.radius = 0.5;
    this.holders = new Set();
    this.twoHandDir = null;
    this.seed = Math.random() * 100;
    this.idle = 10; // seconds since last released
    this.busy = false; // part of a bond that is currently arcing
    this.complete = false;
    this.info = null;
    this.angles = [];
    this.arcReveal = 0;
    this.completeAge = 0;
    this.presentAnim = null;
    this.coTimer = -1;
    this.cool = new Map(); // other body id -> time of last rejection
    this.dying = false;
    this.slots = []; // open bonding positions: { atom, dir (body space) }
    this.homeZ = pos.z; // depth the body settles back to when left alone
  }
}

/**
 * Bench simulation: floating atoms, pinch-dragging, bonding sequences,
 * VSEPR relaxation, rejection and break-up. Chemistry decisions are delegated
 * to the pure ChemGraph; this class adds space, time and showmanship.
 */
export class World {
  constructor({ stage, fx, strip, events }) {
    this.stage = stage;
    this.fx = fx;
    this.strip = strip;
    this.events = events;
    this.graph = new ChemGraph();
    this.atoms = new Map(); // atom id -> view state
    this.bodies = new Map();
    this.pending = []; // bonds in their lightning phase
    this.bondFx = new Map(); // bond object -> { flash }
    this.queue = []; // delayed callbacks { t, fn }
    this.time = 0;
    this.temp = 25;
    this.visible = 1;
    this.tempGesture = false;
    this.previews = []; // { a, b, ok } links a held fragment is about to make
  }

  get atomCount() {
    return this.atoms.size;
  }

  after(delay, fn) {
    this.queue.push({ t: this.time + delay, fn });
  }

  bodyOf(atomId) {
    return this.bodies.get(this.atoms.get(atomId).bodyId);
  }

  // ------------------------------------------------------------ spawning
  spawn(symbol, pos, pointer = null) {
    if (this.atoms.size >= MAX_ATOMS) {
      this.events.onWarn('The bench is full. Press C to clear it.');
      return null;
    }
    const el = ELEMENTS[symbol];
    const atom = this.graph.addAtom(symbol);
    const body = new Body(pos);
    body.atoms.push(atom.id);
    body.local.set(atom.id, new THREE.Vector3());
    body.target.set(atom.id, new THREE.Vector3());
    body.radius = el.display;
    this.bodies.set(body.id, body);
    this.atoms.set(atom.id, {
      id: atom.id, el, bodyId: body.id, world: pos.clone(), seed: Math.random(), born: this.time,
      scale: 0, flash: 0, alert: 0,
    });
    this.setSlots(body);
    this.fx.converge(pos, 70, el.cpk, 1.5, 0.48);
    this.after(0.42, () => this.fx.ring(this.atoms.get(atom.id)?.world || pos, el.display * 3.2, el.cpk, 0.4));
    if (pointer) this.grab(pointer, body, true);
    this.events.onSpawn(atom, el);
    return body;
  }

  setSlots(body, layout = null) {
    const l = layout || layoutMolecule(this.graph, body.atoms, { approx: true });
    body.slots = l.slots.map((sl) => ({ atom: sl.atom, dir: new THREE.Vector3(sl.dir[0], sl.dir[1], sl.dir[2]) }));
  }

  // ------------------------------------------------------------ grabbing
  pick(p) {
    const stage = this.stage;
    let best = null;
    let bestScore = 0.34;
    for (const atom of this.atoms.values()) {
      const body = this.bodies.get(atom.bodyId);
      if (!body || body.dying) continue;
      stage.project(atom.world, _v);
      const dx = (_v.x - p.nx) * stage.halfW;
      const dy = (_v.y - p.ny) * VIEW.halfH;
      const score = Math.hypot(dx, dy) - atom.el.display * _v.z;
      if (score < bestScore) {
        bestScore = score;
        best = { atom, body };
      }
    }
    return best;
  }

  grab(p, body, fresh = false) {
    this.stage.project(body.pos, _v);
    p.held = body;
    p.grab = fresh ? { dnx: 0, dny: 0, dz: 0 } : { dnx: _v.x - p.nx, dny: _v.y - p.ny, dz: body.pos.z - p.z };
    body.holders.add(p);
    body.twoHandDir = null;
    body.idle = 0;
    this.events.onGrab(body, p);
  }

  release(p) {
    const body = p.held;
    p.held = null;
    if (!body) return;
    body.holders.delete(p);
    body.twoHandDir = null;
    if (body.holders.size === 0) {
      body.idle = 0;
      body.homeZ = body.pos.z;
      body.vel.copy(p.vel).multiplyScalar(0.18).clampLength(0, 2.2);
      body.vel.z = 0;
      this.events.onRelease(body, p);
    } else {
      // remaining hand keeps the body without a jump
      for (const other of body.holders) {
        this.stage.project(body.pos, _v);
        other.grab = { dnx: _v.x - other.nx, dny: _v.y - other.ny, dz: body.pos.z - other.z };
      }
    }
  }

  holdTarget(p, out) {
    const g = p.grab;
    return this.stage.unproject(p.nx + g.dnx, p.ny + g.dny, clamp(p.z + g.dz, DEPTH.min, DEPTH.max), out);
  }

  // ------------------------------------------------------------ main update
  update(dt, time, pointers, interactive) {
    this.time = time;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].t <= time) {
        const { fn } = this.queue[i];
        this.queue.splice(i, 1);
        fn();
      }
    }
    if (interactive) this.handlePointers(pointers, dt);
    else for (const p of pointers) if (p.held && this.bodies.get(p.held.id) === p.held) this.release(p);
    this.moveHeld(dt);
    this.detectBonds();
    this.updatePending(dt);
    this.integrate(dt);
    this.updateAtoms(dt);
  }

  handlePointers(pointers, dt) {
    for (const p of pointers) {
      p.cool = Math.max(0, (p.cool || 0) - dt);
      if (!p.active) {
        if (p.held) this.release(p);
        p.hover = null;
        continue;
      }
      if (p.held && (p.held.dying || this.bodies.get(p.held.id) !== p.held)) p.held = null;
      p.hover = p.held ? null : this.pick(p);

      if (p.pinchDown && !p.held) {
        const tile = this.strip.hit(p.nx, p.ny);
        if (tile) {
          tile.flash = 1;
          this.spawn(tile.el.symbol, this.stage.unproject(p.nx, p.ny, clamp(p.z, DEPTH.min, DEPTH.max), _a), p);
        } else if (p.hover) this.grab(p, p.hover.body);
      }
      if (p.held && !p.pinch) this.release(p);

      // mouse extras: right-drag rotates, double-click breaks
      if (p.rotate) {
        const body = p.held || p.hover?.body;
        if (body) {
          _q.setFromAxisAngle(AXIS_Y, p.rotate.dx * 0.011);
          _q2.setFromAxisAngle(AXIS_X, p.rotate.dy * 0.011);
          body.base.premultiply(_q).premultiply(_q2);
          body.presentAnim = null;
          body.spin.set(0, 0, 0);
        }
      }
      if (p.breakNow && p.hover && p.hover.body.atoms.length > 1) this.breakBody(p.hover.body, p.pos);

      // open-palm swipe: a fast flat hand passing through a molecule shatters it
      if (p.kind === 'hand' && p.open && !p.pinch && !this.tempGesture && p.cool <= 0 && p.palmVel.length() > 9) {
        for (const body of this.bodies.values()) {
          if (body.atoms.length < 2 || body.dying || body.busy) continue;
          this.stage.project(body.pos, _v);
          const dx = (_v.x - p.palmN.x) * this.stage.halfW;
          const dy = (_v.y - p.palmN.y) * VIEW.halfH;
          if (Math.hypot(dx, dy) < body.radius * _v.z + 0.45) {
            this.breakBody(body, p.palm, p.palmVel);
            p.cool = 0.7;
            break;
          }
        }
      }
    }
  }

  moveHeld(dt) {
    for (const body of this.bodies.values()) {
      const n = body.holders.size;
      if (!n) continue;
      body.idle = 0;
      if (n === 1) {
        const [p] = body.holders;
        this.holdTarget(p, _v);
        _w.copy(body.pos);
        body.pos.lerp(_v, damp(26, dt));
        if (dt > 0) body.vel.subVectors(body.pos, _w).divideScalar(dt);
      } else {
        // two-hand grip: midpoint carries the molecule, the hand-to-hand axis rotates it
        const [p1, p2] = body.holders;
        _v.addVectors(p1.pos, p2.pos).multiplyScalar(0.5);
        _v.z = clamp((p1.z + p2.z) * 0.5, DEPTH.min, DEPTH.max);
        this.stage.unproject((p1.nx + p2.nx) * 0.5, (p1.ny + p2.ny) * 0.5, _v.z, _v);
        body.pos.lerp(_v, damp(22, dt));
        _d.subVectors(p2.pos, p1.pos);
        if (_d.lengthSq() > 1e-4) {
          _d.normalize();
          if (body.twoHandDir) {
            _q.setFromUnitVectors(body.twoHandDir, _d);
            body.base.premultiply(_q);
          } else body.twoHandDir = new THREE.Vector3();
          body.twoHandDir.copy(_d);
          body.presentAnim = null;
          body.spin.set(0, 0, 0);
        }
        body.vel.set(0, 0, 0);
      }
    }
  }

  // ------------------------------------------------------------ bonding
  detectBonds() {
    this.previews.length = 0;
    for (const A of this.bodies.values()) {
      if (A.busy || A.dying) continue;
      if (A.holders.size === 0 && A.idle > 1.1) continue; // only bodies the user is moving initiate
      for (const B of this.bodies.values()) {
        if (B === A || B.busy || B.dying) continue;
        if (A.pos.distanceTo(B.pos) > A.radius + B.radius + 2.2) continue;
        // closest pair of atoms that are within reacting distance
        let near = null;
        for (const ia of A.atoms) {
          const va = this.atoms.get(ia);
          for (const ib of B.atoms) {
            const vb = this.atoms.get(ib);
            const reach = va.el.display + vb.el.display + BOND_REACH;
            const d = va.world.distanceTo(vb.world);
            if (d <= reach * 2.1 && (!near || d / reach < near.f)) near = { f: d / reach, a: ia, b: ib };
          }
        }
        if (!near) continue;
        const touching = near.f <= 1;
        // The fragments touch. If any two of their atoms can bond, the nearest such
        // pair reacts (the arc pulls them into place), so the user never has to
        // line up a particular atom. Only chemically impossible contact is refused.
        let ok = null;
        for (const ia of A.atoms) {
          if (this.graph.freeValence(ia) < 1) continue;
          const va = this.atoms.get(ia);
          for (const ib of B.atoms) {
            if (this.graph.freeValence(ib) < 1) continue;
            const d = va.world.distanceTo(this.atoms.get(ib).world);
            if (ok && d >= ok.d) continue;
            if (this.graph.checkBond(ia, ib).ok) ok = { d, a: ia, b: ib };
          }
        }
        if (!touching) {
          // not there yet: show what would happen on contact
          if (A.holders.size) this.previews.push(ok ? { a: ok.a, b: ok.b, ok: true } : { a: near.a, b: near.b, ok: false });
          continue;
        }
        if (ok) {
          this.startBond(ok.a, ok.b, A, B);
          break;
        }
        if (near.f < 0.85 && this.time - (A.cool.get(B.id) || -10) > 1.4) {
          this.reject(near.a, near.b, A, B, this.graph.checkBond(near.a, near.b));
          break;
        }
      }
    }
  }

  startBond(a, b, A, B) {
    A.busy = true;
    B.busy = true;
    const va = this.atoms.get(a);
    const vb = this.atoms.get(b);
    this.pending.push({ a, b, A, B, t: 0 });
    this.fx.bolt(va.world, vb.world, ARC_TIME, COL.white, 0.014);
    this.events.onArc(va, vb);
  }

  updatePending(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      const va = this.atoms.get(p.a);
      const vb = this.atoms.get(p.b);
      if (!va || !vb || p.A.dying || p.B.dying) {
        p.A.busy = false;
        p.B.busy = false;
        this.pending.splice(i, 1);
        continue;
      }
      p.t += dt;
      // the atoms are drawn together while the arc builds
      _d.subVectors(vb.world, va.world);
      const dist = _d.length();
      const want = bondLengthGuess(va, vb);
      if (dist > 1e-4) {
        _d.multiplyScalar(((dist - want) / dist) * damp(9, dt));
        const aFree = p.A.holders.size === 0;
        const bFree = p.B.holders.size === 0;
        if (aFree && bFree) {
          p.A.pos.addScaledVector(_d, 0.5);
          p.B.pos.addScaledVector(_d, -0.5);
        } else if (bFree) p.B.pos.sub(_d);
        else if (aFree) p.A.pos.add(_d);
      }
      va.flash = Math.max(va.flash, 0.1 + (p.t / ARC_TIME) * 0.3);
      vb.flash = Math.max(vb.flash, 0.1 + (p.t / ARC_TIME) * 0.3);
      if (p.t >= ARC_TIME) {
        this.pending.splice(i, 1);
        p.A.busy = false;
        p.B.busy = false;
        this.commitBond(p.a, p.b, p.A, p.B);
      }
    }
  }

  commitBond(a, b, A, B) {
    const res = this.graph.bond(a, b);
    if (!res.ok) return;
    const va = this.atoms.get(a);
    const vb = this.atoms.get(b);
    // merge the smaller body into the larger (or into the held one)
    let keep = A;
    let gone = B;
    if (B.atoms.length > A.atoms.length || (B.atoms.length === A.atoms.length && B.holders.size > A.holders.size)) {
      keep = B;
      gone = A;
    }
    const vel = keep.vel.clone().multiplyScalar(keep.atoms.length).addScaledVector(gone.vel, gone.atoms.length)
      .divideScalar(keep.atoms.length + gone.atoms.length);
    for (const id of gone.atoms) {
      keep.atoms.push(id);
      this.atoms.get(id).bodyId = keep.id;
    }
    for (const h of gone.holders) {
      keep.holders.add(h);
      h.held = keep;
    }
    gone.holders.clear();
    this.bodies.delete(gone.id);
    keep.vel.copy(vel);
    keep.complete = false;
    keep.coTimer = -1;
    keep.cool.clear();
    this.relayout(keep);
    for (const h of keep.holders) {
      this.stage.project(keep.pos, _v);
      h.grab = { dnx: _v.x - h.nx, dny: _v.y - h.ny, dz: keep.pos.z - h.z };
    }
    keep.twoHandDir = null;

    // impact
    _v.addVectors(va.world, vb.world).multiplyScalar(0.5);
    const mid = _v.clone();
    const ionic = res.type === 'ionic';
    this.bondFx.set(res.bond, { flash: 1 });
    va.flash = 0.5;
    vb.flash = 0.5;
    this.fx.flare(mid, ionic ? 1.5 : 1.0 + res.order * 0.25, COL.white, 0.4);
    this.fx.ring(mid, 1.3 + res.order * 0.35, COL.accent, 0.45);
    // a puff of dots in the two atoms' own colours
    this.fx.burst(mid, 9 + res.order * 4, va.el.cpk, 1.4, 0.055, 0.6);
    this.fx.burst(mid, 9 + res.order * 4, vb.el.cpk, 1.4, 0.055, 0.6);
    this.fx.flash = Math.max(this.fx.flash, 0.15);
    this.events.onBond(res, va, vb, keep);

    const info = identify(this.graph, keep.atoms);
    keep.info = info;
    if (info.complete) this.after(0.3, () => this.celebrate(keep));
    else if (this.graph.canStabilizeCO(keep.atoms)) keep.coTimer = 0;
    this.events.onFragment(keep, info);
  }

  /** Recompute the VSEPR target layout, keeping every atom where it currently is. */
  relayout(body, entry = null) {
    const ids = body.atoms;
    const layout = layoutMolecule(this.graph, ids, entry
      ? { angles: entry.angles, dihedral: entry.dihedral, approx: !!entry.approx }
      : { approx: true });
    const centroid = new THREE.Vector3();
    for (const id of ids) centroid.add(this.atoms.get(id).world);
    centroid.divideScalar(ids.length);
    const from = [];
    const to = [];
    for (const id of ids) {
      from.push(layout.positions.get(id));
      const w = this.atoms.get(id).world;
      to.push([w.x - centroid.x, w.y - centroid.y, w.z - centroid.z]);
    }
    const q = bestFitRotation(from, to);
    const fit = new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
    const inv = fit.clone().invert();
    body.pos.copy(centroid);
    // keep the displayed orientation continuous: base = fit · wobble⁻¹
    body.base.copy(fit).multiply(this.wobble(body, _q).invert());
    body.quat.copy(fit);
    body.local.clear();
    body.target.clear();
    for (const id of ids) {
      const w = this.atoms.get(id).world;
      body.local.set(id, new THREE.Vector3().subVectors(w, centroid).applyQuaternion(inv));
      const t = layout.positions.get(id);
      body.target.set(id, new THREE.Vector3(t[0], t[1], t[2]));
    }
    body.radius = layout.radius;
    body.angles = layout.angles;
    this.setSlots(body, layout);
    return layout;
  }

  wobble(body, out) {
    const t = this.time;
    const amp = body.complete ? 1 : 0.35;
    _e.set(Math.sin(t * 0.43 + body.seed) * 0.1 * amp, Math.sin(t * 0.31 + body.seed * 1.7) * 0.24 * amp, Math.sin(t * 0.27 + body.seed * 0.6) * 0.04 * amp);
    return out.setFromEuler(_e);
  }

  /** A fragment just became a complete molecule: the big moment. */
  celebrate(body) {
    if (!this.bodies.has(body.id) || body.dying) return;
    const info = identify(this.graph, body.atoms);
    if (!info.complete) return;
    body.info = info;
    body.complete = true;
    body.completeAge = 0;
    body.arcReveal = 0;
    // re-solve with the molecule's measured angles; relayout keeps the shown pose continuous
    this.relayout(body, info.entry);
    // rotate into a presentation pose: slightly tilted so the 3D shape reads
    const to = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, -0.3, 0));
    body.presentAnim = { t: 0, dur: 1.5, from: body.base.clone(), to };
    body.spin.set(0, 0, 0);

    const col = info.entry ? COL.accent : COL.gold;
    this.fx.shockwave(body.pos);
    this.fx.ring(body.pos, 6.5, col, 1.0);
    this.fx.ring(body.pos, 3.4, col, 0.6);
    this.fx.confetti(body.pos, info.entry ? 110 : 50, 3.4);
    this.fx.flash = 0.3;
    for (const id of body.atoms) this.atoms.get(id).flash = 0.4;
    for (const bond of this.graph.component(body.atoms[0]).bonds) this.bondFx.set(bond, { flash: 1 });
    this.events.onComplete(body, info);
  }

  reject(a, b, A, B, res) {
    A.cool.set(B.id, this.time);
    B.cool.set(A.id, this.time);
    const va = this.atoms.get(a);
    const vb = this.atoms.get(b);
    va.alert = 1;
    vb.alert = 1;
    for (const id of A.atoms) this.atoms.get(id).alert = Math.max(this.atoms.get(id).alert, 0.6);
    for (const id of B.atoms) this.atoms.get(id).alert = Math.max(this.atoms.get(id).alert, 0.6);
    // shove apart: whatever is not in a hand takes the push
    _d.subVectors(vb.world, va.world);
    if (_d.lengthSq() < 1e-6) _d.set(1, 0, 0);
    _d.normalize();
    const aHeld = A.holders.size > 0;
    const bHeld = B.holders.size > 0;
    if (!bHeld) B.vel.addScaledVector(_d, aHeld ? 5.5 : 3.2);
    if (!aHeld) A.vel.addScaledVector(_d, bHeld ? -5.5 : -3.2);
    if (aHeld && bHeld) {
      // both gripped: knock the smaller one out of the hand
      const loser = A.atoms.length <= B.atoms.length ? A : B;
      for (const h of [...loser.holders]) this.release(h);
      loser.vel.addScaledVector(_d, loser === A ? -5.5 : 5.5);
    }
    _v.addVectors(va.world, vb.world).multiplyScalar(0.5);
    this.fx.burst(_v, 16, COL.red, 1.8, 0.05, 0.45);
    this.fx.ring(_v, 2.0, COL.red, 0.4);
    this.fx.ring(_v, 1.2, COL.red, 0.3);
    this.fx.glitch = 0.6;
    this.events.onReject(rejectionText(this.graph, res), res, va, vb);
  }

  /** Shatter a molecule back into free atoms. */
  breakBody(body, from = null, sweep = null) {
    if (body.atoms.length < 2 || body.dying) return;
    for (const h of [...body.holders]) this.release(h);
    const ids = [...body.atoms];
    for (const bond of this.graph.component(ids[0]).bonds) this.bondFx.delete(bond);
    this.graph.breakComponent(ids[0]);
    this.bodies.delete(body.id);
    const centre = body.pos.clone();
    this.fx.ring(centre, 4, COL.accent, 0.6);
    this.fx.ring(centre, 2.2, COL.white, 0.4);
    this.fx.flash = Math.max(this.fx.flash, 0.15);
    const n = ids.length;
    ids.forEach((id, i) => {
      const view = this.atoms.get(id);
      const dir = _v.subVectors(view.world, centre);
      if (dir.lengthSq() < 1e-4) dir.set(Math.cos(i * 2.4), Math.sin(i * 2.4), 0);
      dir.normalize();
      // fan the atoms out on a ring so they cannot instantly re-bond
      const ang = (i / n) * Math.PI * 2 + body.seed;
      const spread = 1.1 + n * 0.16;
      const dest = centre.clone().add(new THREE.Vector3(Math.cos(ang) * spread, Math.sin(ang) * spread * 0.8, (i % 2 ? 0.4 : -0.4)));
      dest.addScaledVector(dir, 0.3);
      if (sweep) dest.addScaledVector(_w.copy(sweep).clampLength(0, 1), 0.6);
      const nb = new Body(dest);
      nb.atoms.push(id);
      nb.local.set(id, new THREE.Vector3());
      nb.target.set(id, new THREE.Vector3());
      nb.radius = view.el.display;
      nb.vel.copy(dir).multiplyScalar(0.4);
      nb.idle = 10;
      this.bodies.set(nb.id, nb);
      view.bodyId = nb.id;
      this.setSlots(nb);
      // shards leave the old position and re-assemble at the new one
      this.fx.reform(view.world, dest, 45, view.el.cpk, view.el.display, 0.75);
      view.world.copy(dest);
      view.born = this.time + 0.3;
      view.scale = 0;
    });
    this.events.onBreak(ids, body, from);
  }

  clear() {
    for (const p of this.pending) {
      p.A.busy = false;
      p.B.busy = false;
    }
    this.pending.length = 0;
    for (const body of this.bodies.values()) for (const h of [...body.holders]) this.release(h);
    for (const view of this.atoms.values()) this.fx.burst(view.world, 18, view.el.cpk, 1.4, 0.04, 0.6);
    const ids = [...this.atoms.keys()];
    for (const id of ids) this.graph.removeAtom(id);
    this.atoms.clear();
    this.bodies.clear();
    this.bondFx.clear();
    this.events.onClear(ids);
  }

  // ------------------------------------------------------------ motion
  integrate(dt) {
    const stage = this.stage;
    const xMax = stage.halfW - 1.3;
    const xMin = -stage.halfW + 3; // the mode rail covers the left edge
    const yMax = VIEW.halfH - 2.2;
    const yMin = -VIEW.halfH + 1.5;
    const heat = clamp((this.temp + 60) / 220, 0, 1);
    const bodies = [...this.bodies.values()];

    for (const body of bodies) {
      body.idle += dt;
      // settle the lone C=O into carbon monoxide
      if (body.coTimer >= 0) {
        if (body.holders.size || body.busy) body.coTimer = 0;
        else body.coTimer += dt;
        if (body.coTimer > CO_SETTLE) {
          body.coTimer = -1;
          const bond = this.graph.stabilizeCO(body.atoms);
          if (bond) {
            this.bondFx.set(bond, { flash: 1 });
            this.events.onDative(bond, body);
            this.after(0.35, () => this.celebrate(body));
          }
        }
      }

      // shape relaxation toward the VSEPR target
      const k = damp(6.5, dt);
      for (const id of body.atoms) body.local.get(id).lerp(body.target.get(id), k);

      if (body.complete) {
        body.completeAge += dt;
        if (body.completeAge > 0.45) body.arcReveal = Math.min(1, body.arcReveal + dt / 0.8);
      }
      if (body.presentAnim) {
        const a = body.presentAnim;
        a.t += dt;
        const e = easeInOut(a.t / a.dur);
        // slerp to the presentation pose with one extra flourish turn that unwinds
        body.base.slerpQuaternions(a.from, a.to, e);
        _q.setFromAxisAngle(AXIS_Y, (1 - e) * Math.PI * 2); // a full turn is the identity at t = 0
        body.base.multiply(_q);
        if (a.t >= a.dur) {
          body.base.copy(a.to);
          body.presentAnim = null;
        }
      } else if (!body.complete && body.holders.size < 2 && body.atoms.length > 1) {
        // unfinished fragments tumble lazily
        const s = body.spin;
        _q.setFromAxisAngle(_v.copy(s).normalize(), s.length() * dt * (0.5 + heat));
        if (s.lengthSq() > 1e-8) body.base.premultiply(_q);
      }
      body.quat.copy(body.base).multiply(this.wobble(body, _q));

      if (body.holders.size) continue;
      // gentle drift + thermal agitation
      const t = this.time;
      const drift = 0.05 + heat * heat * 0.9;
      body.vel.x += Math.sin(t * 0.7 + body.seed * 3.1) * drift * dt;
      body.vel.y += Math.cos(t * 0.6 + body.seed * 1.7) * drift * dt;
      body.vel.z += (body.homeZ + Math.sin(t * 0.45 + body.seed * 2.3) * 0.12 - body.pos.z) * 2.5 * dt;
      // soft walls
      const p = body.pos;
      if (p.x > xMax) body.vel.x -= (p.x - xMax) * 9 * dt;
      if (p.x < xMin) body.vel.x -= (p.x - xMin) * 9 * dt;
      if (p.y > yMax) body.vel.y -= (p.y - yMax) * 9 * dt;
      if (p.y < yMin) body.vel.y -= (p.y - yMin) * 9 * dt;
      if (p.z > 2.6) body.vel.z -= (p.z - 2.6) * 9 * dt;
      if (p.z < -3) body.vel.z -= (p.z + 3) * 9 * dt;
      body.vel.multiplyScalar(Math.exp(-1.7 * dt));
    }

    // idle bodies keep a polite distance, so only deliberate moves cause reactions
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j];
        if (A.busy && B.busy) continue;
        if (A.holders.size && B.holders.size) continue;
        const aActive = A.holders.size > 0 || A.idle < 1.1;
        const bActive = B.holders.size > 0 || B.idle < 1.1;
        if (aActive || bActive) continue;
        _d.subVectors(B.pos, A.pos);
        const d = _d.length() || 1e-3;
        const min = A.radius + B.radius + BOND_REACH + 0.35;
        if (d < min) {
          _d.multiplyScalar(((min - d) / d) * 4 * dt);
          B.vel.add(_d);
          A.vel.sub(_d);
        }
      }
    }
    for (const body of bodies) if (!body.holders.size) body.pos.addScaledVector(body.vel, dt);
  }

  updateAtoms(dt) {
    const jitter = 0.004 + clamp((this.temp + 60) / 220, 0, 1) * 0.022;
    const t = this.time;
    for (const view of this.atoms.values()) {
      const body = this.bodies.get(view.bodyId);
      if (!body) continue;
      _v.copy(body.local.get(view.id)).applyQuaternion(body.quat).add(body.pos);
      // thermal vibration
      _v.x += Math.sin(t * 31 + view.seed * 90) * jitter;
      _v.y += Math.cos(t * 27 + view.seed * 70) * jitter;
      _v.z += Math.sin(t * 23 + view.seed * 50) * jitter;
      view.world.copy(_v);
      const age = t - view.born - 0.22;
      view.scale = age <= 0 ? 0 : age >= 0.42 ? 1 : easeOutBack(age / 0.42);
      view.flash = Math.max(0, view.flash - dt * 2.2);
      view.alert = Math.max(0, view.alert - dt * 1.5);
    }
    for (const [bond, fx] of this.bondFx) {
      fx.flash = Math.max(0, fx.flash - dt * 1.8);
      if (!this.graph.bonds.includes(bond)) this.bondFx.delete(bond);
    }
  }

  // ------------------------------------------------------------ drawing
  /** @param k 0..1 presence of the bench (atoms shrink away when the water chamber takes over) */
  draw(batches, time, k = 1) {
    if (k < 0.01) return;
    const { atoms, tubes, beams, glow, labels, text } = batches;
    const graph = this.graph;
    const eye = this.stage.eye;

    for (const view of this.atoms.values()) {
      const node = graph.atom(view.id);
      const s = view.scale * k;
      if (s <= 0.001) continue;
      // a fresh bond makes the atom swell and settle, like jelly
      const r = view.el.display * s * (1 + view.flash * 0.2 * Math.cos(view.flash * 14));
      atoms.add(view.world, r, view.el.cpk, view.seed, view.flash, view.alert);
      // symbol printed on the side of the sphere that faces the viewer
      labels.add(labelAnchor(view.world, r, eye, _w), r * 0.56, view.el.ink, s, BB.GLYPH, glyphIndex(view.el.symbol, node.charge));
      if (node.charge !== 0) {
        // ions carry a thin pulsing charge ring
        const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
        glow.add(view.world, r * (1.9 + pulse * 0.25), node.charge > 0 ? COL.hot : COL.blue, 0.8 * k, BB.RING, 0.9, 0.02);
      }
    }

    // bonds: one shaded tube per shared electron pair
    for (const bond of graph.bonds) {
      const va = this.atoms.get(bond.a);
      const vb = this.atoms.get(bond.b);
      if (!va || !vb) continue;
      if (bond.type === 'ionic') continue; // nothing is shared in an ionic bond, so nothing is drawn between the ions
      const fl = this.bondFx.get(bond)?.flash || 0;
      bondEnds(va, vb, _a, _b, _d);
      bondPerp(_d, _perp);
      const n = bond.order;
      const sc = Math.min(va.scale, vb.scale) * k;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * BOND_SPREAD * sc;
        _v.copy(_a).addScaledVector(_perp, off);
        _w.copy(_b).addScaledVector(_perp, off);
        tubes.add(_v, _w, va.el.cpk, vb.el.cpk, (n === 1 ? 0.06 : 0.045) * sc, va.seed * 10 + i * 3.7, fl);
      }
    }

    for (const body of this.bodies.values()) {
      // open bonding positions: a short stub + socket for every bond the atom can still make
      for (const slot of body.slots) {
        const view = this.atoms.get(slot.atom);
        if (!view || view.scale < 0.9) continue;
        _d.copy(slot.dir).applyQuaternion(body.quat);
        const r = view.el.display;
        _a.copy(view.world).addScaledVector(_d, r * 0.95);
        _b.copy(view.world).addScaledVector(_d, r + 0.2);
        beams.add(_a, _b, COL.accent, COL.accent, 0.009, 0.6 * k, BEAM.SOLID);
        glow.add(_b, 0.07, COL.accent, 0.9 * k, BB.RING, 0.62, 0.17);
      }
      // angle arcs on finished molecules
      if (body.complete && body.arcReveal > 0) {
        for (const ang of body.angles) {
          const c = this.atoms.get(ang.centre);
          const p1 = this.atoms.get(ang.a);
          const p2 = this.atoms.get(ang.b);
          if (!c || !p1 || !p2) continue;
          _a.subVectors(p1.world, c.world).normalize();
          _b.subVectors(p2.world, c.world).normalize();
          this.fx.drawAngleArc(c.world, _a, _b, c.el.display + 0.2, body.arcReveal, COL.gold, 0.95 * k, ang.label);
        }
      }
      // caption under multi-atom bodies
      if (body.atoms.length > 1 && body.info && k > 0.5) {
        // just below the lowest atom as currently oriented
        let low = Infinity;
        for (const id of body.atoms) {
          const view = this.atoms.get(id);
          low = Math.min(low, view.world.y - view.el.display);
        }
        _v.set(body.pos.x, low - 0.3, body.pos.z);
        const info = body.info;
        if (body.complete) {
          const name = info.entry ? info.name : 'Unnamed structure';
          text.draw(`${info.formula} · ${name}`, _v, 0.17, info.entry ? COL.white : COL.gold, 0.95 * clamp(body.completeAge * 2, 0, 1));
        } else if (body.coTimer >= 0) {
          const n = Math.ceil((body.coTimer / CO_SETTLE) * 6);
          text.draw(`C=O settling ${'●'.repeat(n)}${'○'.repeat(6 - n)}`, _v, 0.14, COL.accent, 0.9);
        }
      }
      // grip feedback
      if (body.holders.size) {
        glow.add(body.pos, body.radius + 0.38, COL.accent, 0.5 * k, BB.RING, 0.92, 0.008);
        if (body.holders.size > 1) glow.add(body.pos, body.radius + 0.8, COL.white, 0.6 * k, BB.TURN, time);
      }
    }

    // what a held fragment will do on contact: green dashes = will bond, red = refused
    for (const pv of this.previews) {
      const va = this.atoms.get(pv.a);
      const vb = this.atoms.get(pv.b);
      if (!va || !vb) continue;
      const col = pv.ok ? COL.ok : COL.red;
      beams.add(va.world, vb.world, col, col, 0.016, 0.95 * k, BEAM.DASH, 1.3);
      glow.add(vb.world, vb.el.display + 0.22, col, 0.8 * k, BB.RING, 0.9, 0.014);
    }
  }
}

export const BOND_SPREAD = 0.15;

function bondLengthGuess(va, vb) {
  return va.el.display + vb.el.display + 0.3;
}

/** Bond end points just inside the two atom surfaces; `dir` receives the unit axis. */
export function bondEnds(va, vb, a, b, dir) {
  dir.subVectors(vb.world, va.world);
  const len = dir.length() || 1e-4;
  dir.divideScalar(len);
  a.copy(va.world).addScaledVector(dir, Math.min(va.el.display * va.scale * 0.8, len * 0.45));
  b.copy(vb.world).addScaledVector(dir, -Math.min(vb.el.display * vb.scale * 0.8, len * 0.45));
}

/** Direction in which the parallel tubes of a multiple bond are spread (faces the viewer). */
export function bondPerp(dir, out) {
  out.set(-dir.y, dir.x, 0);
  if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
  return out.normalize();
}

export { CATALOG, bondLength };
