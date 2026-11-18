import * as THREE from 'three';
import { GlassPanel } from './glass.js';
import { COL } from '../config.js';
import { clamp, damp, easeOutBack } from '../core/math.js';

export const FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif';
export const FONT_ROUND = `ui-rounded, "SF Pro Rounded", ${FONT}`;

/** Immediate-mode pool of camera-facing text quads with cached canvas textures. */
export class TextSprites {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.used = 0;
    this.cache = new Map();
    this.geometry = new THREE.PlaneGeometry(1, 1);
  }

  texture(text) {
    let entry = this.cache.get(text);
    if (entry) return entry;
    const pad = 18;
    const px = 64;
    const font = `600 ${px}px ${FONT}`;
    const canvas = document.createElement('canvas');
    let g = canvas.getContext('2d');
    g.font = font;
    canvas.width = Math.ceil(g.measureText(text).width) + pad * 2;
    canvas.height = px + pad * 2;
    g = canvas.getContext('2d');
    g.font = font;
    g.textBaseline = 'middle';
    // a soft dark halo keeps white type legible over any webcam image
    g.shadowColor = 'rgba(0, 0, 0, 0.6)';
    g.shadowBlur = 12;
    g.shadowOffsetY = 2;
    g.fillStyle = '#fff';
    g.fillText(text, pad, canvas.height / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    entry = { tex, aspect: canvas.width / canvas.height };
    if (this.cache.size > 160) {
      const [k, v] = this.cache.entries().next().value;
      v.tex.dispose();
      this.cache.delete(k);
    }
    this.cache.set(text, entry);
    return entry;
  }

  begin() {
    this.used = 0;
  }

  /** @param align -1 left edge at pos, 0 centred, 1 right edge at pos */
  draw(text, pos, height, col = COL.white, alpha = 1, align = 0) {
    if (alpha <= 0.01) return;
    const { tex, aspect } = this.texture(text);
    let mesh = this.pool[this.used];
    if (!mesh) {
      mesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
      );
      mesh.renderOrder = 20;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.pool.push(mesh);
    }
    this.used++;
    if (mesh.material.map !== tex) {
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
    }
    mesh.material.color.setRGB(col[0], col[1], col[2]);
    mesh.material.opacity = alpha;
    // the texture carries padding for the halo; scale so `height` is the type size
    const h = height * 1.3;
    const w = h * aspect;
    mesh.scale.set(w, h, 1);
    mesh.position.set(pos.x - align * (w * 0.5 - h * 0.18), pos.y, pos.z);
    mesh.visible = true;
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}

function wrap(g, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (g.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = probe;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const INK = '#ffffff';
const INK2 = 'rgba(235, 235, 245, 0.64)';
const INK3 = 'rgba(235, 235, 245, 0.4)';

/**
 * Info card: a frosted-glass window floating beside the molecule it describes.
 * Content is drawn once to a canvas texture; the pane pops in with a spring.
 */
export class InfoCard {
  constructor(stage) {
    this.W = 1024;
    this.H = 660;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.anisotropy = 8;
    this.width = 3.7;
    this.height = (this.width * this.H) / this.W;
    this.panel = new GlassPanel(stage, { renderOrder: 22, depthTest: false, map: this.tex, tint: [0.045, 0.045, 0.06] });
    this.panel.setSize(this.width, this.height, 0.24);
    this.mesh = this.panel.mesh;

    this.bodyId = null;
    this.age = 0;
    this.life = 0;
    this.side = 1;
    this.opacity = 0;
    this.anchor = new THREE.Vector3(); // card edge the tether attaches to
    this.active = false;
  }

  draw(info) {
    const g = this.canvas.getContext('2d');
    const { W, H } = this;
    const P = 52;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';

    // header line
    g.font = `600 23px ${FONT}`;
    g.fillStyle = INK2;
    g.fillText(info.header, P, 66);
    g.textAlign = 'right';
    g.fillStyle = INK3;
    g.fillText(info.tag || '', W - P, 66);

    // formula pill (right)
    let fPx = 40;
    g.font = `700 ${fPx}px ${FONT_ROUND}`;
    while (g.measureText(info.formula).width > 230 && fPx > 22) {
      fPx -= 2;
      g.font = `700 ${fPx}px ${FONT_ROUND}`;
    }
    const pillW = g.measureText(info.formula).width + 48;
    const pillX = W - P - pillW;
    g.fillStyle = info.color || '#0a84ff';
    roundRect(g, pillX, 98, pillW, 64, 32);
    g.fill();
    g.fillStyle = info.ink || '#fff';
    g.textAlign = 'center';
    g.fillText(info.formula, pillX + pillW / 2, 130 + fPx * 0.36);
    g.textAlign = 'left';

    // emoji + name
    let x = P;
    if (info.emoji) {
      g.font = `52px ${FONT}`;
      g.fillStyle = '#fff';
      g.fillText(info.emoji, x, 150);
      x += g.measureText(info.emoji).width + 16;
    }
    let namePx = 58;
    g.font = `700 ${namePx}px ${FONT_ROUND}`;
    while (g.measureText(info.name).width > pillX - x - 24 && namePx > 28) {
      namePx -= 3;
      g.font = `700 ${namePx}px ${FONT_ROUND}`;
    }
    g.fillStyle = INK;
    g.fillText(info.name, x, 150);

    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    g.fillRect(P, 190, W - P * 2, 2);

    // data rows
    let y = 240;
    for (const [k, v] of info.rows) {
      g.font = `500 23px ${FONT}`;
      g.fillStyle = INK2;
      g.fillText(k, P, y);
      let px = 27;
      g.font = `600 ${px}px ${FONT}`;
      while (g.measureText(v).width > W - 250 - P && px > 16) {
        px -= 1;
        g.font = `600 ${px}px ${FONT}`;
      }
      g.fillStyle = INK;
      g.fillText(v, 250, y + 1);
      y += 46;
    }

    // the "why" paragraph
    y += 2;
    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    g.fillRect(P, y - 26, W - P * 2, 2);
    g.font = `400 26px ${FONT}`;
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (const line of wrap(g, info.fact, W - P * 2).slice(0, 6)) {
      y += 36;
      g.fillText(line, P, y);
    }

    // footnote (model disclaimer)
    g.font = `400 17px ${FONT}`;
    g.fillStyle = INK3;
    g.fillText(info.note || '', P, H - 34);
    this.tex.needsUpdate = true;
  }

  show(info, bodyId, life = 11) {
    this.draw(info);
    this.bodyId = bodyId;
    this.age = 0;
    this.life = life;
    this.active = true;
    this.opacity = 0;
    this.fresh = true;
  }

  hide() {
    if (this.active) this.life = Math.min(this.life, this.age + 0.01);
  }

  /** @param target world position + radius of the molecule the card describes */
  update(dt, time, target, radius, stage) {
    if (!this.active) {
      this.panel.alpha = 0;
      return;
    }
    this.age += dt;
    const fadeOut = clamp((this.life - this.age) / 0.35, 0, 1);
    this.opacity = Math.min(1, this.age / 0.18) * fadeOut;
    if (this.age > this.life) {
      this.active = false;
      this.opacity = 0;
      this.panel.alpha = 0;
      this.bodyId = null;
      return;
    }
    const m = this.mesh;
    if (target) {
      // sit on whichever side has more room; the left is the quiet side of the HUD
      if (this.fresh) this.side = target.x < -1.2 ? 1 : -1;
      const gap = radius + 0.75 + this.width * 0.5;
      const hw = stage.halfW - this.width * 0.5 - 0.5;
      const tx = clamp(target.x + this.side * gap, -hw + 1.6, hw - 1.1); // clear of the mode rail on the left
      const ty = clamp(target.y + 0.1, -1.4, 0.5);
      const tz = clamp(target.z, -2, 1.5);
      if (this.fresh) {
        m.position.set(tx, ty, tz);
        this.fresh = false;
      } else {
        const k = damp(5, dt);
        m.position.x += (tx - m.position.x) * k;
        m.position.y += (ty - m.position.y) * k;
        m.position.z += (tz - m.position.z) * k;
      }
    }
    // spring in, ease away
    const pop = 0.72 + 0.28 * easeOutBack(clamp(this.age / 0.5, 0, 1));
    m.scale.setScalar(pop * (0.94 + 0.06 * fadeOut));
    m.rotation.set(0.015 * Math.sin(time * 0.8), -this.side * 0.13 + 0.02 * Math.sin(time * 0.6), 0);
    m.updateMatrixWorld();
    this.anchor.set(-this.side * this.width * 0.5, -this.height * 0.5 + 0.3, 0).applyMatrix4(m.matrixWorld);
    this.panel.alpha = this.opacity;
  }
}
