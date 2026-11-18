import * as THREE from 'three';
import { BEAM, BB, glyphIndex, labelAnchor } from './batches.js';
import { ELEMENTS } from '../chemistry/elements.js';
import { COL } from '../config.js';
import { clamp, damp } from '../core/math.js';

const _o = new THREE.Vector3();
const _h = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export const PHASE_COLOR = {
  ICE: [0.8, 0.92, 1.0],
  LIQUID: [0.39, 0.82, 1.0],
  GAS: [1.0, 0.62, 0.1],
};
export const PHASE_TINT = {
  ICE: [0.9, 0.97, 1.1],
  LIQUID: [1, 1, 1],
  GAS: [1.1, 0.95, 0.84],
};
const PHASE_NOTE = {
  ICE: 'Solid · open hexagonal lattice',
  LIQUID: 'Liquid · H-bonds break and re-form',
  GAS: 'Gas · too fast to bond',
};

const PHASE_NAME = { ICE: 'Ice', LIQUID: 'Water', GAS: 'Steam' };

const BOX_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Draws the water chamber: molecules, O–H sticks, dashed hydrogen bonds, a thin glass-box outline. */
export class WaterView {
  constructor(sim) {
    this.sim = sim;
    this.centre = new THREE.Vector3(0, -0.35, -1.2);
    this.scale = 0.72; // simulation units -> scene units (keeps the chamber inside the HUD frame)
    this.yaw = 0;
    this.pitch = 0.12;
    this.quat = new THREE.Quaternion();
    this.color = [...PHASE_COLOR.LIQUID];
    this.seeds = Array.from({ length: sim.n }, () => Math.random());
    this.pulse = 0;
    this.corners = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.eye = null; // viewer position, set by the app (labels are printed on the facing side)
  }

  rotate(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -0.7, 0.7);
  }

  toWorld(x, y, z, out) {
    return out.set(x, y, z).multiplyScalar(this.scale).applyQuaternion(this.quat).add(this.centre);
  }

  /** World position of molecule i's oxygen. */
  moleculeWorld(i, out) {
    const p = this.sim.pos;
    return this.toWorld(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], out);
  }

  update(dt, time) {
    // slow idle sway so the 3D structure is always readable
    _e.set(this.pitch + Math.sin(time * 0.23) * 0.05, this.yaw + Math.sin(time * 0.17) * 0.42, 0, 'YXZ');
    _q.setFromEuler(_e);
    this.quat.slerp(_q, damp(6, dt));
    const target = PHASE_COLOR[this.sim.phase];
    const k = damp(1.6, dt);
    for (let i = 0; i < 3; i++) this.color[i] += (target[i] - this.color[i]) * k;
    this.pulse = Math.max(0, this.pulse - dt * 0.8);
  }

  draw(batches, time, alpha) {
    if (alpha < 0.01) return;
    const { atoms, tubes, beams, glow, labels, text } = batches;
    const eye = this.eye;
    const sim = this.sim;
    const { pos, H, n } = sim;
    const colO = ELEMENTS.O.cpk;
    const colH = ELEMENTS.H.cpk;
    const rO = 0.215 * this.scale;
    const rH = 0.135 * this.scale;
    const pc = this.color;

    for (let i = 0; i < n; i++) {
      this.toWorld(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], _o);
      const seed = this.seeds[i];
      const lock = sim.lock[i];
      atoms.add(_o, rO * alpha, colO, seed, this.pulse * 0.5 + lock * 0.05, 0);
      if (eye) labels.add(labelAnchor(_o, rO * alpha, eye, _a), rO * 0.55 * alpha, COL.white, 1, BB.GLYPH, glyphIndex('O'));
      for (let h = 0; h < 2; h++) {
        this.toWorld(H[i * 6 + h * 3], H[i * 6 + h * 3 + 1], H[i * 6 + h * 3 + 2], _h);
        atoms.add(_h, rH * alpha, colH, seed + 0.3 + h * 0.2, this.pulse * 0.5, 0);
        tubes.add(_o, _h, colO, colH, 0.045 * this.scale * alpha, seed * 9 + h, 0);
      }
    }

    // hydrogen bonds: dashed, from each H to the oxygen it is attracted to
    for (const hb of sim.hbonds) {
      const i = hb.mol;
      this.toWorld(H[i * 6 + hb.h * 3], H[i * 6 + hb.h * 3 + 1], H[i * 6 + hb.h * 3 + 2], _h);
      this.toWorld(pos[hb.to * 3], pos[hb.to * 3 + 1], pos[hb.to * 3 + 2], _o);
      _d.subVectors(_o, _h).normalize();
      _a.copy(_h).addScaledVector(_d, rH * 0.9);
      _b.copy(_o).addScaledVector(_d, -rO * 0.95);
      beams.add(_a, _b, pc, pc, 0.012, clamp(hb.strength, 0, 1) * alpha, BEAM.DASH, i * 0.37 + hb.h);
    }

    // chamber
    const [bx, by, bz] = sim.box.map((v) => v + 0.45);
    for (let c = 0; c < 8; c++) this.toWorld(c & 1 ? bx : -bx, c & 2 ? by : -by, c & 4 ? bz : -bz, this.corners[c]);
    for (const [p, q] of BOX_EDGES) beams.add(this.corners[p], this.corners[q], COL.accent, COL.accent, 0.009, 0.45 * alpha, BEAM.SOLID);
    for (let c = 0; c < 8; c++) glow.add(this.corners[c], 0.05, COL.accent, 0.9 * alpha, BB.NODE);
    // floor lines give the box a ground plane
    for (let k = 1; k < 6; k++) {
      const f = -bx + (k / 6) * 2 * bx;
      this.toWorld(f, -by, -bz, _a);
      this.toWorld(f, -by, bz, _b);
      beams.add(_a, _b, COL.accent, COL.accent, 0.005, 0.2 * alpha, BEAM.SOLID);
    }
    // a soft band rising up the chamber walls
    const run = (time * 0.35) % 1;
    for (const [p, q] of [[0, 1], [1, 5], [5, 4], [4, 0]]) {
      _a.copy(this.corners[p]).lerp(this.corners[p + 2], run);
      _b.copy(this.corners[q]).lerp(this.corners[q + 2], run);
      beams.add(_a, _b, pc, pc, 0.008, 0.4 * Math.sin(Math.PI * run) * alpha, BEAM.SOLID);
    }

    // floating read-outs attached to the chamber
    this.toWorld(-bx, by + 0.55, bz, _a);
    text.draw(PHASE_NAME[sim.phase], _a, 0.36, COL.white, alpha, -1);
    this.toWorld(-bx, by + 0.14, bz, _a);
    text.draw(PHASE_NOTE[sim.phase], _a, 0.14, pc, 0.95 * alpha, -1);
    this.toWorld(bx, by + 0.14, bz, _a);
    text.draw(`${n} × H₂O · ${sim.bondsPerMolecule().toFixed(1)} H-bonds per molecule`, _a, 0.14, pc, 0.95 * alpha, 1);
  }
}
