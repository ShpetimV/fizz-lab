// Small dependency-free math helpers shared by tracking, physics and rendering.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => clamp(x, 0, 1);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const remap = (x, a, b, c, d) => c + (d - c) * saturate((x - a) / (b - a));
// Frame-rate independent exponential approach: returns the blend factor for `rate` (1/s).
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const easeOutCubic = (t) => 1 - Math.pow(1 - saturate(t), 3);
export const easeInOut = (t) => {
  t = saturate(t);
  return t * t * (3 - 2 * t);
};
export const easeOutBack = (t) => {
  t = saturate(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Deterministic PRNG (mulberry32) so layouts and tests are reproducible.
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng = Math.random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One Euro filter (Casiez et al. 2012): a low-pass filter whose cutoff rises with
 * signal speed, so slow movement is steady and fast movement stays responsive.
 */
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(value, dt) {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += (rawDx - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }
}

// ---- tiny array-based vec3 / quaternion helpers (used by the pure modules) ----
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  angle: (a, b) => {
    const d = v3.dot(v3.norm(a), v3.norm(b));
    return Math.acos(clamp(d, -1, 1));
  },
  // any unit vector perpendicular to a
  perp: (a) => {
    const n = v3.norm(a);
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return v3.norm(v3.cross(n, ref));
  },
  // rotate v around unit axis k by angle (Rodrigues)
  rotate: (v, k, angle) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kxv = v3.cross(k, v);
    const kdv = v3.dot(k, v) * (1 - c);
    return [v[0] * c + kxv[0] * s + k[0] * kdv, v[1] * c + kxv[1] * s + k[1] * kdv, v[2] * c + kxv[2] * s + k[2] * kdv];
  },
};

// Quaternions as [x, y, z, w].
export const quat = {
  identity: () => [0, 0, 0, 1],
  fromAxisAngle: (axis, angle) => {
    const h = angle / 2;
    const s = Math.sin(h);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
  },
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  norm: (q) => {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  rotate: (q, v) => {
    // v' = v + 2w(u × v) + 2u × (u × v)
    const u = [q[0], q[1], q[2]];
    const uv = v3.cross(u, v);
    const uuv = v3.cross(u, uv);
    return [v[0] + 2 * (q[3] * uv[0] + uuv[0]), v[1] + 2 * (q[3] * uv[1] + uuv[1]), v[2] + 2 * (q[3] * uv[2] + uuv[2])];
  },
  // shortest rotation taking unit vector a to unit vector b
  between: (a, b) => {
    const d = v3.dot(a, b);
    if (d < -0.999999) return quat.fromAxisAngle(v3.perp(a), Math.PI);
    const c = v3.cross(a, b);
    return quat.norm([c[0], c[1], c[2], 1 + d]);
  },
};

/**
 * Best-fit rotation (Horn's closed-form quaternion method, solved by power
 * iteration) such that R * from[i] ≈ to[i] for centred point sets.
 * Returns a quaternion [x, y, z, w].
 */
export function bestFitRotation(from, to) {
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < from.length; i++) {
    const a = from[i];
    const b = to[i];
    Sxx += a[0] * b[0]; Sxy += a[0] * b[1]; Sxz += a[0] * b[2];
    Syx += a[1] * b[0]; Syy += a[1] * b[1]; Syz += a[1] * b[2];
    Szx += a[2] * b[0]; Szy += a[2] * b[1]; Szz += a[2] * b[2];
  }
  // Symmetric 4x4 matrix whose dominant eigenvector is the optimal quaternion (w, x, y, z).
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  // Shift so all eigenvalues are positive, then power-iterate.
  let shift = 0;
  for (let i = 0; i < 4; i++) {
    let rowSum = 0;
    for (let j = 0; j < 4; j++) rowSum += Math.abs(N[i][j]);
    shift = Math.max(shift, rowSum);
  }
  if (shift < 1e-12) return [0, 0, 0, 1];
  for (let i = 0; i < 4; i++) N[i][i] += shift;
  let q = [1, 0.01, 0.02, 0.03];
  for (let iter = 0; iter < 80; iter++) {
    const n = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) n[i] += N[i][j] * q[j];
    const l = Math.hypot(n[0], n[1], n[2], n[3]) || 1;
    q = [n[0] / l, n[1] / l, n[2] / l, n[3] / l];
  }
  return [q[1], q[2], q[3], q[0]];
}
