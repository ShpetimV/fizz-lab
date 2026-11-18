import * as THREE from 'three';
import { OneEuro, clamp, damp, smoothstep } from '../core/math.js';
import { DEPTH } from '../config.js';

// MediaPipe hand landmark indices
export const LM = {
  WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_PIP: 10,
  MIDDLE_TIP: 12, RING_MCP: 13, RING_PIP: 14, RING_TIP: 16, PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};
export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
export const FINGERTIPS = [4, 8, 12, 16, 20];

// Pinch = thumb-tip ↔ index-tip distance divided by hand size (wrist ↔ middle MCP).
// Two thresholds (hysteresis) so the state cannot chatter around a single value.
const PINCH_ON = 0.3;
const PINCH_OFF = 0.46;
const LOST_AFTER = 0.3; // seconds a hand may vanish before its pinch is dropped

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * One tracked hand, exposed to the rest of the app as a generic "pointer"
 * (the mouse fallback implements the same fields).
 */
export class HandPointer {
  constructor(id) {
    this.id = id;
    this.kind = 'hand';
    this.active = false;
    this.lastSeen = -10;
    this.lastT = 0;
    this.filters = Array.from({ length: 63 }, () => new OneEuro(1.4, 14, 1));
    this.raw = new Float32Array(63); // filtered image-space landmarks
    this.disp = new Float32Array(63); // render-rate smoothed copy
    this.fresh = true;
    this.ratioFilter = new OneEuro(3, 1.2, 1);
    this.sizeFilter = new OneEuro(0.7, 3, 1);
    this.ratio = 1;
    this.size = 0.17;
    this.offCount = 0;
    this.openCount = 0;

    this.pinch = false;
    this.pinchDown = false;
    this.pinchUp = false;
    this._prevPinch = false;
    this.charge = 0; // 0 open … 1 fully pinched (drives spark + sound)
    this.open = false;
    this.nx = 0;
    this.ny = 0;
    this.z = 0;
    this.pos = new THREE.Vector3(); // pinch point (world)
    this.vel = new THREE.Vector3();
    this.palm = new THREE.Vector3();
    this.palmVel = new THREE.Vector3();
    this.palmN = new THREE.Vector2();
    this.joints = Array.from({ length: 21 }, () => new THREE.Vector3());
    this.appear = 0; // 0..1 fade for the hologram skeleton
    this.rotate = null;
    this.breakNow = false;
    this._prevPos = new THREE.Vector3();
    this._prevPalm = new THREE.Vector3();
    this._hasPrev = false;
  }
}

export class Gestures {
  constructor(stage) {
    this.stage = stage;
    this.hands = [new HandPointer('A'), new HandPointer('B')];
    this.stamp = -1;
    this.temp = { active: false, hold: 0, value: 0.5, mid: new THREE.Vector3() };
    this.count = 0;
  }

  /** Feed a fresh HandLandmarkerResult (tracking rate). */
  ingest(result, t) {
    const n = result?.landmarks?.length || 0;
    const taken = [false, false];
    const assign = new Array(n).fill(-1);
    // match detections to slots by wrist proximity so identities never swap
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const w = result.landmarks[i][0];
      for (let s = 0; s < 2; s++) {
        const h = this.hands[s];
        const recent = t - h.lastSeen < 0.6;
        const d = recent ? Math.hypot(w.x - h.raw[0], w.y - h.raw[1]) : 0.6 + s * 0.01;
        pairs.push([d, i, s]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, i, s] of pairs) {
      if (assign[i] !== -1 || taken[s]) continue;
      assign[i] = s;
      taken[s] = true;
    }

    for (let i = 0; i < n; i++) {
      const s = assign[i];
      if (s < 0) continue;
      const h = this.hands[s];
      const lm = result.landmarks[i];
      const wl = result.worldLandmarks?.[i] || lm;
      const reappeared = t - h.lastSeen > LOST_AFTER;
      const dt = reappeared ? 0 : t - h.lastT;
      if (reappeared) {
        for (const f of h.filters) f.reset();
        h.ratioFilter.reset();
        h.sizeFilter.reset();
        h.fresh = true;
      }
      for (let j = 0; j < 21; j++) {
        h.raw[j * 3] = h.filters[j * 3].filter(lm[j].x, dt);
        h.raw[j * 3 + 1] = h.filters[j * 3 + 1].filter(lm[j].y, dt);
        h.raw[j * 3 + 2] = h.filters[j * 3 + 2].filter(lm[j].z, dt);
      }
      h.lastSeen = t;
      h.lastT = t;

      // pinch ratio from metric world landmarks: rotation- and distance-invariant
      const handSize = dist3(wl[LM.WRIST], wl[LM.MIDDLE_MCP]) || 1e-3;
      h.ratio = h.ratioFilter.filter(dist3(wl[LM.THUMB_TIP], wl[LM.INDEX_TIP]) / handSize, dt);
      if (!h.pinch) {
        if (h.ratio < PINCH_ON) {
          h.pinch = true;
          h.offCount = 0;
        }
      } else if (h.ratio > PINCH_OFF) {
        if (++h.offCount >= 2) h.pinch = false; // release must persist for two frames
      } else h.offCount = 0;

      // open palm: all four fingers extended (tip clearly farther from the wrist than its PIP joint)
      let ext = 0;
      const w = wl[LM.WRIST];
      if (dist3(wl[LM.INDEX_TIP], w) > dist3(wl[LM.INDEX_PIP], w) * 1.18) ext++;
      if (dist3(wl[LM.MIDDLE_TIP], w) > dist3(wl[LM.MIDDLE_PIP], w) * 1.18) ext++;
      if (dist3(wl[LM.RING_TIP], w) > dist3(wl[LM.RING_PIP], w) * 1.18) ext++;
      if (dist3(wl[LM.PINKY_TIP], w) > dist3(wl[LM.PINKY_PIP], w) * 1.15) ext++;
      const isOpen = ext === 4 && h.ratio > 0.55 && !h.pinch;
      h.openCount = isOpen ? Math.min(h.openCount + 1, 4) : Math.max(h.openCount - 1, 0);
      h.open = h.openCount >= 2;

      // apparent size (fraction of image height) from several palm spans so that
      // tilting the hand does not read as moving away
      const va = this.stage.videoAspect;
      const d2 = (a, b) => Math.hypot((lm[a].x - lm[b].x) * va, lm[a].y - lm[b].y);
      const span = Math.max(d2(0, 9), d2(5, 17) * 1.5, d2(0, 5) * 0.98, d2(0, 17) * 1.08);
      h.size = h.sizeFilter.filter(span, dt);
    }

    for (let s = 0; s < 2; s++) {
      const h = this.hands[s];
      if (!taken[s] && t - h.lastSeen > LOST_AFTER) {
        h.pinch = false;
        h.open = false;
        h.openCount = 0;
      }
    }
  }

  /** Per render frame: smooth to display rate, lift landmarks into world space, derive events. */
  update(dt, t) {
    const stage = this.stage;
    const cover = stage.cover;
    let count = 0;
    for (const h of this.hands) {
      const present = t - h.lastSeen < LOST_AFTER;
      h.appear += ((present ? 1 : 0) - h.appear) * damp(present ? 10 : 6, dt);
      h.active = present;
      h.pinchDown = h.pinch && !h._prevPinch;
      h.pinchUp = !h.pinch && h._prevPinch;
      h._prevPinch = h.pinch;
      if (!present) {
        h._hasPrev = false;
        h.charge += (0 - h.charge) * damp(10, dt);
        continue;
      }
      count++;
      const k = h.fresh ? 1 : damp(38, dt);
      h.fresh = false;
      for (let i = 0; i < 63; i++) h.disp[i] += (h.raw[i] - h.disp[i]) * k;

      // hand depth from apparent size; per-joint relief from MediaPipe's relative z
      const zHand = clamp((h.size - 0.17) * 24, DEPTH.min, DEPTH.max);
      const zScale = (2 * stage.halfW) / cover.x * 0.8;
      for (let j = 0; j < 21; j++) {
        const nx = ((1 - h.disp[j * 3] - 0.5) / cover.x) * 2;
        const ny = (-(h.disp[j * 3 + 1] - 0.5) / cover.y) * 2;
        const z = zHand - h.disp[j * 3 + 2] * zScale;
        stage.unproject(nx, ny, z, h.joints[j]);
      }
      const a = h.joints[LM.THUMB_TIP];
      const b = h.joints[LM.INDEX_TIP];
      h.nx = ((1 - (h.disp[12] + h.disp[24]) * 0.5 - 0.5) / cover.x) * 2;
      h.ny = (-((h.disp[13] + h.disp[25]) * 0.5 - 0.5) / cover.y) * 2;
      h.z = zHand;
      h.pos.addVectors(a, b).multiplyScalar(0.5);
      h.palm.set(0, 0, 0);
      for (const j of [0, 5, 9, 13, 17]) h.palm.add(h.joints[j]);
      h.palm.multiplyScalar(0.2);
      stage.project(h.palm, _v);
      h.palmN.set(_v.x, _v.y);

      if (h._hasPrev && dt > 0) {
        const kv = damp(18, dt);
        _v.subVectors(h.pos, h._prevPos).divideScalar(dt);
        h.vel.lerp(_v, kv);
        _v.subVectors(h.palm, h._prevPalm).divideScalar(dt);
        h.palmVel.lerp(_v, kv);
      } else {
        h.vel.set(0, 0, 0);
        h.palmVel.set(0, 0, 0);
      }
      h._prevPos.copy(h.pos);
      h._prevPalm.copy(h.palm);
      h._hasPrev = true;

      const target = h.pinch ? 1 : smoothstep(0.95, PINCH_ON, h.ratio) * 0.8;
      h.charge += (target - h.charge) * damp(14, dt);
    }
    this.count = count;

    // temperature gesture: both palms open, distance between them = temperature
    const [A, B] = this.hands;
    const both = A.active && B.active && A.open && B.open;
    const tg = this.temp;
    tg.hold = both ? tg.hold + dt : 0;
    tg.active = tg.hold > 0.3;
    if (tg.active) {
      const aspect = stage.aspect;
      const d = Math.hypot((A.palmN.x - B.palmN.x) * aspect, A.palmN.y - B.palmN.y) / (2 * aspect);
      tg.value = clamp((d - 0.12) / (0.72 - 0.12), 0, 1);
      tg.mid.addVectors(A.palm, B.palm).multiplyScalar(0.5);
    }
  }
}

const _v = new THREE.Vector3();
