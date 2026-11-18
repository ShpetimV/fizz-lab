import * as THREE from 'three';
import { COL } from '../config.js';
import { easeInOut } from '../core/math.js';
import { bondEnds, bondPerp, BOND_SPREAD } from '../physics/world.js';

const _o = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Valence electrons, drawn as glowing points with comet trails.
 *
 * Simplified Bohr-style picture: each atom shows its real number of valence
 * electrons circling on tilted orbits. When a covalent bond forms, one electron
 * per shared pair leaves each atom and shuttles along the bond; in an ionic
 * bond a single electron jumps from the metal to its partner and stays there.
 */
export class Electrons {
  constructor(points, rings) {
    this.points = points;
    this.ringBatch = rings;
    this.list = [];
    this.orbits = []; // one entry per (atom, ring): { atom, u, v, radius }
    this.trail = 7;
    this.speed = 1;
  }

  addAtom(atomId, count, seed) {
    const rings = count <= 2 ? 1 : count <= 4 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      const ring = k % rings;
      const perRing = Math.ceil(count / rings);
      // ring planes tilted differently per atom so no two atoms look alike
      const tilt = (ring / rings) * Math.PI + seed * 6.28;
      const normal = new THREE.Vector3(Math.sin(tilt) * 0.85, Math.cos(tilt) * 0.85, 0.5 + 0.3 * Math.sin(seed * 40 + ring * 2)).normalize();
      const u = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
      const v = new THREE.Vector3().crossVectors(normal, u);
      if (k < rings) this.orbits.push({ atom: atomId, ring, u, v, radius: 1.42 + ring * 0.13 });
      this.list.push({
        ring,
        home: atomId, owner: atomId, from: null, xfer: 1,
        bond: null, slot: 0, blend: 0,
        u, v, radius: 1.42 + ring * 0.13,
        phase: (Math.floor(k / rings) / perRing) * Math.PI * 2 + ring * 1.1,
        speed: (2.3 + ring * 0.35) * (ring % 2 ? -1 : 1),
        hot: 0,
      });
    }
  }

  removeAtoms(ids) {
    const set = new Set(ids);
    this.list = this.list.filter((e) => !set.has(e.home));
    this.orbits = this.orbits.filter((o) => !set.has(o.atom));
  }

  /** Covalent: `order` electrons from each atom move into the bond. Ionic: one electron changes owner. */
  onBond(res) {
    const bond = res.bond;
    if (res.type === 'ionic') {
      const e = this.list.find((x) => x.owner === res.donor && !x.bond);
      if (e) {
        e.from = res.donor;
        e.owner = res.acceptor;
        e.xfer = 0;
        e.hot = 1;
      }
      return;
    }
    this.share(bond, bond.a, res.order, 0);
    this.share(bond, bond.b, res.order, res.order);
  }

  /** Dative closure: the donor atom alone supplies one more shared pair. */
  onDative(bond) {
    this.share(bond, bond.donor, 2, 4);
  }

  share(bond, atomId, count, slotStart) {
    let slot = slotStart;
    for (const e of this.list) {
      if (count <= 0) break;
      if (e.owner === atomId && !e.bond) {
        e.bond = bond;
        e.slot = slot++;
        e.hot = 1;
        count--;
      }
    }
  }

  /** Bonds broken: every electron returns to the atom it came from. */
  onBreak(ids) {
    const set = new Set(ids);
    for (const e of this.list) {
      if (!set.has(e.home)) continue;
      if (e.owner !== e.home) {
        e.from = e.owner;
        e.owner = e.home;
        e.xfer = 0;
      }
      e.bond = null;
      e.hot = 1;
    }
  }

  orbit(atom, e, t, out) {
    const r = atom.el.display * atom.scale * e.radius;
    const a = e.phase + e.speed * t * this.speed;
    return out.copy(atom.world).addScaledVector(e.u, Math.cos(a) * r).addScaledVector(e.v, Math.sin(a) * r);
  }

  along(world, e, t, out) {
    const bond = e.bond;
    const va = world.atoms.get(bond.a);
    const vb = world.atoms.get(bond.b);
    if (!va || !vb) return null;
    bondEnds(va, vb, _a, _b, _d);
    bondPerp(_d, _perp);
    const n = bond.order;
    const beam = e.slot % n; // which of the parallel beams this electron rides
    const off = (beam - (n - 1) / 2) * BOND_SPREAD;
    const s = 0.5 + 0.34 * Math.sin(t * 2.6 * this.speed + e.slot * 2.4 + e.phase);
    out.copy(_a).lerp(_b, s).addScaledVector(_perp, off);
    // corkscrew just outside the tube surface, so the pair is seen winding around the bond
    _n.crossVectors(_d, _perp);
    const h = t * 7 + e.slot * 1.7;
    const rr = n === 1 ? 0.105 : 0.085;
    return out.addScaledVector(_perp, Math.cos(h) * rr).addScaledVector(_n, Math.sin(h) * rr);
  }

  position(world, e, t, out) {
    const owner = world.atoms.get(e.owner);
    if (!owner) return null;
    this.orbit(owner, e, t, out);
    if (e.xfer < 1 && e.from !== null) {
      const src = world.atoms.get(e.from);
      if (src) {
        const k = easeInOut(e.xfer);
        this.orbit(src, e, t, _o);
        out.lerpVectors(_o, out, k);
        out.y += Math.sin(Math.PI * k) * 0.55; // the jump arcs over the gap
      }
    }
    if (e.blend > 0.001 && e.bond) {
      if (this.along(world, e, t, _o)) out.lerp(_o, easeInOut(e.blend));
    }
    return out;
  }

  update(dt) {
    for (const e of this.list) {
      const target = e.bond ? 1 : 0;
      e.blend += Math.sign(target - e.blend) * Math.min(Math.abs(target - e.blend), dt / 0.65);
      if (e.xfer < 1) e.xfer = Math.min(1, e.xfer + dt / 0.95);
      e.hot = Math.max(0, e.hot - dt * 0.9);
    }
  }

  draw(world, time, k = 1) {
    const pts = this.points;
    const trail = this.trail;
    const step = 0.03;

    // faint orbit rings, only where an electron is actually still orbiting
    const busy = new Set();
    for (const e of this.list) if (!e.bond || e.blend < 0.5) busy.add(`${e.owner}:${e.ring}`);
    for (const o of this.orbits) {
      const atom = world.atoms.get(o.atom);
      if (!atom || atom.scale < 0.9 || !busy.has(`${o.atom}:${o.ring}`)) continue;
      this.ringBatch.add(atom.world, o.u, o.v, atom.el.display * o.radius * k, COL.electron, 0.2 * k);
    }

    for (const e of this.list) {
      const owner = world.atoms.get(e.owner);
      if (!owner || owner.scale < 0.5) continue;
      const moving = e.hot;
      for (let i = 0; i < trail; i++) {
        if (!this.position(world, e, time - i * step, _p)) break;
        const f = 1 - i / trail;
        const size = (i === 0 ? 0.085 : 0.05 * f) * (1 + moving * 0.7) * k;
        pts.add(_p.x, _p.y, _p.z, moving > 0.3 ? COL.white : COL.electron, i === 0 ? 1 : 0.4 * f, size);
      }
    }
  }
}
