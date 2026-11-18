import * as THREE from 'three';
import { BEAM, BB } from './batches.js';
import { BONES, FINGERTIPS, LM } from '../gestures/gestures.js';
import { COL } from '../config.js';

const _m = new THREE.Vector3();

/**
 * Hand rig: thin white bones with round joints and fingertip dots. Thumb and
 * index carry the "pinch gauge": a ring that closes in as the fingers approach
 * and a sparkle when the grab fires, so it is obvious when a pinch will land.
 */
export function drawHand(h, fx, time) {
  const a = h.appear;
  if (a < 0.02) return;
  const { beams, glow } = fx;
  const j = h.joints;
  const col = COL.accent;

  for (let i = 0; i < BONES.length; i++) {
    const [p, q] = BONES[i];
    beams.add(j[p], j[q], col, col, 0.011, 0.6 * a, BEAM.SOLID);
  }
  for (let i = 0; i < 21; i++) glow.add(j[i], 0.04, col, 0.85 * a, BB.NODE);
  for (const tip of FINGERTIPS) {
    const pinchTip = tip === LM.THUMB_TIP || tip === LM.INDEX_TIP;
    glow.add(j[tip], pinchTip ? 0.13 : 0.1, pinchTip && h.pinch ? COL.ok : col, a, BB.DOT);
  }

  // open palm: a ring in the palm shows the hand is "armed" for swipe / temperature
  if (h.open) glow.add(h.palm, 0.6, col, 0.55 * a, BB.RING, 0.85 + 0.04 * Math.sin(time * 6), 0.014);

  // pinch gauge between thumb and index
  const thumb = j[LM.THUMB_TIP];
  const index = j[LM.INDEX_TIP];
  _m.addVectors(thumb, index).multiplyScalar(0.5);
  if (h.pinch) {
    glow.add(_m, 0.22, COL.white, 0.9 * a, BB.RING, 0.8, 0.07);
    glow.add(_m, 0.2, COL.white, 0.9 * a, BB.SPARKLE, time * 1.5);
  } else if (h.charge > 0.1) {
    beams.add(thumb, index, col, col, 0.008, h.charge * 0.8 * a, BEAM.DASH, h.id === 'A' ? 0.2 : 0.7);
    glow.add(_m, 0.5 - h.charge * 0.28, col, h.charge * 0.9 * a, BB.RING, 0.85, 0.03);
  }
}
