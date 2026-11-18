import * as THREE from 'three';
import { BB, glyphIndex, labelAnchor } from './batches.js';
import { GlassPanel } from './glass.js';
import { ELEMENTS, ELEMENT_ORDER } from '../chemistry/index.js';
import { COL, VIEW } from '../config.js';
import { damp } from '../core/math.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const SOFT = [0.82, 0.82, 0.88];

/** Element tile: one atom, its name and how many bonds it makes. */
export const elementItem = (symbol) => {
  const el = ELEMENTS[symbol];
  return { el, title: el.name, sub: `${el.valence} bond${el.valence > 1 ? 's' : ''}` };
};

/** Material tile: a plain glossy sphere (liquid lab). `id` is handed back on pick. */
export const swatchItem = ({ id, name, sub, color }) => ({ id, swatch: color, title: name, sub });

/**
 * Dock on the window plane at the top of the frame: real 3D atoms (or material
 * swatches) resting on a frosted-glass shelf. They swell as a hand comes near
 * and pinching one pulls a copy out.
 */
export class Strip {
  constructor(stage, items = ELEMENT_ORDER.map(elementItem)) {
    this.stage = stage;
    this.size = 0.92;
    this.visible = 0;
    this.panel = new GlassPanel(stage, { renderOrder: 3, depthTest: true });
    this.setItems(items);
  }

  setItems(items) {
    this.tiles = items.map((item) => ({ ...item, x: 0, y: 0, hover: 0, near: 0, flash: 0, hot: false, nearT: 0 }));
    this.layout();
  }

  layout() {
    const stage = this.stage;
    const n = this.tiles.length;
    const usable = stage.halfW * 2 * 0.46;
    const gap = 1.22;
    const scale = Math.min(1, usable / (gap * Math.max(n, 1)));
    this.size = 0.92 * scale;
    this.gap = gap * scale;
    this.scale = scale;
    const y = VIEW.halfH - 0.36 - this.size * 0.5;
    this.tiles.forEach((t, i) => {
      t.x = (i - (n - 1) / 2) * this.gap;
      t.y = y;
    });
    this.height = this.size + 0.3 * scale + 0.06;
    this.panel.setSize(this.gap * n + 0.16, this.height, 0.36 * scale + 0.06);
    this.panel.mesh.position.set(0, y + this.size * 0.5 + 0.1 - this.height / 2, -0.16);
  }

  /** Tile under window coords (nx, ny), with a forgiving margin. */
  hit(nx, ny) {
    if (this.visible < 0.5) return null;
    const x = nx * this.stage.halfW;
    const y = ny * VIEW.halfH;
    const half = this.gap * 0.5;
    for (const t of this.tiles) {
      if (Math.abs(x - t.x) < half && y > t.y - this.size * 0.8 && y < t.y + this.size * 1.2) return t;
    }
    return null;
  }

  draw(batches, pointers, time, dt, show) {
    this.visible += ((show ? 1 : 0) - this.visible) * damp(6, dt);
    const vis = this.visible;
    this.panel.alpha = vis < 0.02 ? 0 : vis;
    if (vis < 0.02 || !this.tiles.length) return;
    const { atoms, glow, labels, text } = batches;
    const eye = this.stage.eye;
    for (const t of this.tiles) {
      t.hot = false;
      t.nearT = 0;
    }
    for (const p of pointers) {
      if (!p.active || p.held) continue;
      const hit = this.hit(p.nx, p.ny);
      if (hit) hit.hot = true;
      // dock magnification: neighbours of the tile under the hand swell too
      const py = p.ny * VIEW.halfH;
      if (py < this.tiles[0].y - this.size * 1.3) continue;
      const px = p.nx * this.stage.halfW;
      for (const t of this.tiles) {
        const d = (px - t.x) / this.gap;
        t.nearT = Math.max(t.nearT, Math.exp(-d * d * 1.1));
      }
    }
    // the shelf slides up out of the frame when another mode takes over
    const lift = (1 - vis) * 1.6;
    this.panel.mesh.position.y = this.tiles[0].y + this.size * 0.5 + 0.1 - this.height / 2 + lift;
    const s = this.size * 0.5;
    this.tiles.forEach((t, i) => {
      t.hover += ((t.hot ? 1 : 0) - t.hover) * damp(14, dt);
      t.near += (t.nearT - t.near) * damp(12, dt);
      t.flash = Math.max(0, t.flash - dt * 2.5);
      const x = t.x;
      const y = t.y + lift;
      const swell = (1 + t.near * 0.26 + t.hover * 0.1 - t.flash * 0.22) * vis;
      // floats forward when you reach for it
      _c.set(x, y + s * 0.2 + Math.sin(time * 1.6 + i * 0.9) * 0.014 - t.near * 0.03, 0.1 + t.near * 0.3 + t.hover * 0.25);
      let r;
      if (t.swatch) {
        r = 0.24 * this.scale * swell * (t.selected ? 1.1 : 1);
        atoms.add(_c, r, t.swatch, i * 0.17, t.flash * 0.6, 0);
        if (t.selected) glow.add(_c, r * 1.3, COL.white, 0.85 * vis, BB.RING, 0.92, 0.025);
      } else {
        r = t.el.display * 0.62 * this.scale * swell;
        atoms.add(_c, r, t.el.cpk, i * 0.17, t.flash * 0.6, 0);
        labels.add(labelAnchor(_c, r, eye, _b), r * 0.56, t.el.ink, vis, BB.GLYPH, glyphIndex(t.el.symbol));
      }
      if (t.hover > 0.05) glow.add(_c, r * 1.55, COL.accent, t.hover * 0.75 * vis, BB.RING, 0.9, 0.022);
      _a.set(x, y - s * 0.56, 0);
      text.draw(t.title, _a, 0.12 * this.scale + 0.012, COL.white, vis * (0.86 + t.hover * 0.14));
      _a.set(x, y - s * 0.56 - 0.19 * this.scale - 0.02, 0);
      text.draw(t.sub, _a, 0.1 * this.scale + 0.014, SOFT, vis * 0.8);
    });
  }
}
