import * as THREE from 'three';
import {
  atomVert, atomFrag, tubeVert, tubeFrag, ringVert, ringFrag, beamVert, beamFrag, billboardVert, billboardFrag,
  pointFrag, electronVert, particleVert, dustVert, gridVert, gridFrag,
} from '../shaders/scene.js';

// Atoms and bond sticks are opaque and write depth. Thin light-like layers
// (lines, electrons, rings) are additive, order-independent, and depth-TESTED
// against the solids, so they disappear behind atoms like a real object would.
// Confetti and bursts are plain coloured dots (PAINT).
const HOLO = {
  transparent: true,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
};
const PAINT = {
  transparent: true,
  depthTest: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
};
const SOLID = {
  transparent: false,
  depthTest: true,
  depthWrite: true,
};

function instAttr(geo, name, size, capacity) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, attr);
  return attr;
}

/** Immediate-mode instanced batch: begin() → add()… → end() every frame. */
class Batch {
  constructor(capacity) {
    this.capacity = capacity;
    this.count = 0;
    this.attrs = [];
  }

  begin() {
    this.count = 0;
  }

  end() {
    this.geometry.instanceCount = this.count;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
}

// ---------------------------------------------------------------- atoms
export class AtomBatch extends Batch {
  constructor(scene, time, capacity = 320) {
    super(capacity);
    const base = new THREE.SphereGeometry(1, 40, 28);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    this.posR = instAttr(geo, 'iPosR', 4, capacity);
    this.color = instAttr(geo, 'iColor', 3, capacity);
    this.params = instAttr(geo, 'iParams', 4, capacity);
    this.attrs = [this.posR, this.color, this.params];
    this.geometry = geo;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: atomVert, fragmentShader: atomFrag, uniforms: { uTime: time }, ...SOLID }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  add(p, radius, col, seed = 0, flash = 0, alert = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const a = this.posR.array;
    a[i * 4] = p.x; a[i * 4 + 1] = p.y; a[i * 4 + 2] = p.z; a[i * 4 + 3] = radius;
    const c = this.color.array;
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
    const q = this.params.array;
    q[i * 4] = seed; q[i * 4 + 1] = flash; q[i * 4 + 2] = alert; q[i * 4 + 3] = 1;
  }
}

// ---------------------------------------------------------------- bond tubes
export class TubeBatch extends Batch {
  constructor(scene, time, capacity = 512) {
    super(capacity);
    const base = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    base.translate(0, 0.5, 0); // runs 0..1 along +Y
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.start = instAttr(geo, 'iStart', 3, capacity);
    this.endA = instAttr(geo, 'iEnd', 3, capacity);
    this.colA = instAttr(geo, 'iColorA', 4, capacity);
    this.colB = instAttr(geo, 'iColorB', 4, capacity);
    this.seed = instAttr(geo, 'iSeed', 1, capacity);
    this.attrs = [this.start, this.endA, this.colA, this.colB, this.seed];
    this.geometry = geo;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: tubeVert, fragmentShader: tubeFrag, uniforms: { uTime: time }, ...SOLID }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    scene.add(this.mesh);
  }

  add(a, b, colA, colB, radius, seed = 0, flash = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const s = this.start.array;
    s[i * 3] = a.x; s[i * 3 + 1] = a.y; s[i * 3 + 2] = a.z;
    const e = this.endA.array;
    e[i * 3] = b.x; e[i * 3 + 1] = b.y; e[i * 3 + 2] = b.z;
    const ca = this.colA.array;
    ca[i * 4] = colA[0]; ca[i * 4 + 1] = colA[1]; ca[i * 4 + 2] = colA[2]; ca[i * 4 + 3] = radius;
    const cb = this.colB.array;
    cb[i * 4] = colB[0]; cb[i * 4 + 1] = colB[1]; cb[i * 4 + 2] = colB[2]; cb[i * 4 + 3] = flash;
    this.seed.array[i] = seed;
  }
}

// ---------------------------------------------------------------- orbit rings
export class RingBatch extends Batch {
  constructor(scene, capacity = 512) {
    super(capacity);
    const base = new THREE.TorusGeometry(1, 0.011, 5, 64);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.centre = instAttr(geo, 'iCentre', 4, capacity);
    this.u = instAttr(geo, 'iU', 3, capacity);
    this.v = instAttr(geo, 'iV', 3, capacity);
    this.color = instAttr(geo, 'iColor', 4, capacity);
    this.attrs = [this.centre, this.u, this.v, this.color];
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: ringVert, fragmentShader: ringFrag, ...HOLO }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    scene.add(this.mesh);
  }

  add(c, u, v, radius, col, alpha) {
    if (this.count >= this.capacity || alpha <= 0.003) return;
    const i = this.count++;
    const a = this.centre.array;
    a[i * 4] = c.x; a[i * 4 + 1] = c.y; a[i * 4 + 2] = c.z; a[i * 4 + 3] = radius;
    const uu = this.u.array;
    uu[i * 3] = u.x; uu[i * 3 + 1] = u.y; uu[i * 3 + 2] = u.z;
    const vv = this.v.array;
    vv[i * 3] = v.x; vv[i * 3 + 1] = v.y; vv[i * 3 + 2] = v.z;
    const cc = this.color.array;
    cc[i * 4] = col[0]; cc[i * 4 + 1] = col[1]; cc[i * 4 + 2] = col[2]; cc[i * 4 + 3] = alpha;
  }
}

// ---------------------------------------------------------------- beams
export const BEAM = { SOLID: 0, ENERGY: 1, DASH: 2, BOLT: 3 };

export class BeamBatch extends Batch {
  constructor(scene, time, capacity = 3072) {
    super(capacity);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.start = instAttr(geo, 'iStart', 3, capacity);
    this.endA = instAttr(geo, 'iEnd', 3, capacity);
    this.colA = instAttr(geo, 'iColorA', 4, capacity);
    this.colB = instAttr(geo, 'iColorB', 4, capacity);
    this.data = instAttr(geo, 'iData', 4, capacity);
    this.attrs = [this.start, this.endA, this.colA, this.colB, this.data];
    this.geometry = geo;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: beamVert, fragmentShader: beamFrag, uniforms: { uTime: time }, side: THREE.DoubleSide, ...HOLO,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    scene.add(this.mesh);
  }

  add(a, b, colA, colB, width, alpha = 1, mode = 0, seed = 0, flash = 0, alphaB = alpha) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const s = this.start.array;
    s[i * 3] = a.x; s[i * 3 + 1] = a.y; s[i * 3 + 2] = a.z;
    const e = this.endA.array;
    e[i * 3] = b.x; e[i * 3 + 1] = b.y; e[i * 3 + 2] = b.z;
    const ca = this.colA.array;
    ca[i * 4] = colA[0]; ca[i * 4 + 1] = colA[1]; ca[i * 4 + 2] = colA[2]; ca[i * 4 + 3] = alpha;
    const cb = this.colB.array;
    cb[i * 4] = colB[0]; cb[i * 4 + 1] = colB[1]; cb[i * 4 + 2] = colB[2]; cb[i * 4 + 3] = alphaB;
    const d = this.data.array;
    d[i * 4] = width; d[i * 4 + 1] = mode; d[i * 4 + 2] = seed; d[i * 4 + 3] = flash;
  }
}

// ---------------------------------------------------------------- billboards
export const BB = { DOT: 0, RING: 1, GLYPH: 2, TURN: 3, SPARKLE: 4, NODE: 5 };

const ATLAS_ELEMENTS = ['H', 'C', 'N', 'O', 'Na', 'Cl'];

function makeLabelAtlas() {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 6;
  canvas.height = cell * 4;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (px, weight = 700) => `${weight} ${px}px ui-rounded, "SF Pro Rounded", -apple-system, "SF Pro Display", system-ui, sans-serif`;
  const charges = ['', '+', '−'];
  for (let row = 0; row < 3; row++) {
    ATLAS_ELEMENTS.forEach((sym, col) => {
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      const wide = sym.length > 1;
      g.font = font(wide ? 62 : 78);
      const shift = row === 0 ? 0 : wide ? -12 : -10;
      g.fillText(sym, cx + shift, cy + 4);
      if (row > 0) {
        g.font = font(46, 700);
        g.fillText(charges[row], cx + (wide ? 46 : 32), cy - 28);
      }
    });
  }
  // row 3: partial-charge markers δ+ / δ−
  g.font = font(58);
  g.fillText('δ+', cell / 2, 3 * cell + cell / 2);
  g.fillText('δ−', cell + cell / 2, 3 * cell + cell / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

let atlas = null;

/** Atlas cell for an element symbol with charge -1 / 0 / +1. */
export function glyphIndex(symbol, charge = 0) {
  const col = ATLAS_ELEMENTS.indexOf(symbol);
  const row = charge > 0 ? 1 : charge < 0 ? 2 : 0;
  return col + row * 6;
}

/**
 * Where to put a symbol so it reads as printed on a sphere: on the line from
 * the sphere's centre to the eye, pushed just in front of the whole sphere
 * (the camera looks straight down -z, so "in front" means larger z).
 */
export function labelAnchor(centre, radius, eye, out) {
  out.subVectors(eye, centre).normalize();
  const t = (radius * 1.04) / Math.max(0.3, out.z);
  return out.multiplyScalar(t).add(centre);
}

export class BillboardBatch extends Batch {
  constructor(scene, time, capacity = 2048, renderOrder = 14, material = {}) {
    super(capacity);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = instAttr(geo, 'iPos', 3, capacity);
    this.color = instAttr(geo, 'iColor', 4, capacity);
    this.data = instAttr(geo, 'iData', 4, capacity);
    this.attrs = [this.pos, this.color, this.data];
    this.geometry = geo;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: billboardVert,
        fragmentShader: billboardFrag,
        uniforms: { uTime: time, uAtlas: { value: (atlas ||= makeLabelAtlas()) }, uGrid: { value: new THREE.Vector2(6, 4) } },
        ...HOLO,
        ...material,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  add(p, size, col, alpha = 1, mode = 0, p1 = 0, p2 = 0) {
    if (this.count >= this.capacity || alpha <= 0.002) return;
    const i = this.count++;
    const a = this.pos.array;
    a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
    const c = this.color.array;
    c[i * 4] = col[0]; c[i * 4 + 1] = col[1]; c[i * 4 + 2] = col[2]; c[i * 4 + 3] = alpha;
    const d = this.data.array;
    d[i * 4] = size; d[i * 4 + 1] = mode; d[i * 4 + 2] = p1; d[i * 4 + 3] = p2;
  }
}

// ---------------------------------------------------------------- electron points
export class GlowPoints {
  constructor(scene, scale, capacity = 6144) {
    this.capacity = capacity;
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aColor', this.color);
    geo.setAttribute('aSize', this.size);
    this.geometry = geo;
    this.mesh = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ vertexShader: electronVert, fragmentShader: pointFrag, uniforms: { uScale: scale }, ...HOLO }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 16;
    scene.add(this.mesh);
  }

  begin() {
    this.count = 0;
  }

  add(x, y, z, col, alpha, size) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const p = this.pos.array;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    const c = this.color.array;
    c[i * 4] = col[0]; c[i * 4 + 1] = col[1]; c[i * 4 + 2] = col[2]; c[i * 4 + 3] = alpha;
    this.size.array[i] = size;
  }

  end() {
    this.geometry.setDrawRange(0, this.count);
    for (const a of [this.pos, this.color, this.size]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    this.mesh.visible = this.count > 0;
  }
}

// ---------------------------------------------------------------- GPU particles
export const PART = { BURST: 0, CONVERGE: 1, REFORM: 2, CONFETTI: 3 };

export class Particles {
  constructor(scene, time, scale, capacity = 16000) {
    this.capacity = capacity;
    this.cursor = 0;
    this.time = time;
    this.density = 1;
    this.dirty = false;
    const geo = new THREE.BufferGeometry();
    const mk = (n) => new THREE.BufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aStart = mk(3);
    this.aEnd = mk(3);
    this.aTime = mk(4);
    this.aColor = mk(4);
    // particles are born "dead": birth far in the past
    for (let i = 0; i < capacity; i++) {
      this.aTime.array[i * 4] = -1000;
      this.aTime.array[i * 4 + 1] = 1;
    }
    geo.setAttribute('position', this.aStart); // three wants a position attribute
    geo.setAttribute('aStart', this.aStart);
    geo.setAttribute('aEnd', this.aEnd);
    geo.setAttribute('aTime', this.aTime);
    geo.setAttribute('aColor', this.aColor);
    this.mesh = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: particleVert, fragmentShader: pointFrag, uniforms: { uTime: time, uScale: scale }, ...PAINT,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    scene.add(this.mesh);
  }

  /** Emit one particle. `end` is a displacement for BURST, a target otherwise. */
  emit(sx, sy, sz, ex, ey, ez, life, mode, col, size, delay = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const s = this.aStart.array;
    s[i * 3] = sx; s[i * 3 + 1] = sy; s[i * 3 + 2] = sz;
    const e = this.aEnd.array;
    e[i * 3] = ex; e[i * 3 + 1] = ey; e[i * 3 + 2] = ez;
    const t = this.aTime.array;
    t[i * 4] = this.time.value + delay; t[i * 4 + 1] = life; t[i * 4 + 2] = mode; t[i * 4 + 3] = Math.random();
    const c = this.aColor.array;
    c[i * 4] = col[0]; c[i * 4 + 1] = col[1]; c[i * 4 + 2] = col[2]; c[i * 4 + 3] = size;
    this.dirty = true;
  }

  /** Scale a requested particle count by the quality setting. */
  n(count) {
    return Math.max(4, Math.round(count * this.density));
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.aStart.needsUpdate = true;
    this.aEnd.needsUpdate = true;
    this.aTime.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- atmosphere
export class Dust {
  constructor(scene, time, scale) {
    this.scene = scene;
    this.uniforms = {
      uTime: time,
      uScale: scale,
      uEnergy: { value: 0.2 },
      uColor: { value: new THREE.Vector3(1, 1, 1) },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: dustVert, fragmentShader: pointFrag, uniforms: this.uniforms, ...HOLO });
    this.mesh = null;
    this.setCount(600);
  }

  setCount(count) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = -22 + Math.random() * 28; // from deep behind the window to just in front of the lens
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = 0.035 + Math.random() * 0.06;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.mesh = new THREE.Points(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
  }
}

export class Grid {
  constructor(scene, time, halfH) {
    this.uniforms = {
      uTime: time,
      uColor: { value: new THREE.Vector3(1, 1, 1) },
      uAlpha: { value: 0.38 },
      uPulse: { value: 100 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: gridVert, fragmentShader: gridFrag, uniforms: this.uniforms, side: THREE.DoubleSide, ...HOLO,
    });
    const geo = new THREE.PlaneGeometry(160, 110);
    geo.rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.position.set(0, -halfH - 0.9, -46);
    this.floor.frustumCulled = false;
    this.floor.renderOrder = 1;
    scene.add(this.floor);
  }
}
