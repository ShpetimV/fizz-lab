import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';
import { DEPTH } from '../config.js';

/**
 * Mouse + keyboard fallback. Emits the same pointer shape as a tracked hand:
 *   left-drag = pinch · right-drag = rotate · double-click = break
 *   wheel = temperature · shift+wheel = depth · arrow keys = head parallax
 */
export class MousePointer {
  constructor(stage, canvas) {
    this.stage = stage;
    this.id = 'mouse';
    this.kind = 'mouse';
    this.active = false;
    this.pinch = false;
    this.pinchDown = false;
    this.pinchUp = false;
    this._prevPinch = false;
    this._button = false;
    this.charge = 0;
    this.open = false;
    this.nx = 0;
    this.ny = 0;
    this.z = 0;
    this.depth = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.palm = this.pos;
    this.palmVel = this.vel;
    this.rotate = null; // {dx, dy} accumulated right-drag since last frame
    this._rot = { on: false, dx: 0, dy: 0 };
    this.breakNow = false;
    this._break = false;
    this.wheelTemp = 0; // accumulated wheel delta for temperature
    this.head = new THREE.Vector2(); // -1..1 from arrow keys
    this._keys = new Set();
    this._sx = 0;
    this._sy = 0;
    this._moved = false;
    this._prev = new THREE.Vector3();
    this._has = false;

    const toNdc = (e) => {
      const r = canvas.getBoundingClientRect();
      this._sx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this._sy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    canvas.addEventListener('pointermove', (e) => {
      toNdc(e);
      this._moved = true;
      if (this._rot.on) {
        this._rot.dx += e.movementX;
        this._rot.dy += e.movementY;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      toNdc(e);
      this._moved = true;
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0) this._button = true;
      if (e.button === 2) this._rot.on = true;
    });
    const up = (e) => {
      if (e.button === 0) this._button = false;
      if (e.button === 2) this._rot.on = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => {
      this._button = false;
      this._rot.on = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', (e) => {
      toNdc(e);
      this._break = true;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          // browsers turn shift+wheel into horizontal scroll
          const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
          this.depth = clamp(this.depth - d * 0.006, DEPTH.min, DEPTH.max);
        } else this.wheelTemp -= e.deltaY;
        this._moved = true;
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow')) {
        this._keys.add(e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.key));
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._button = false;
      this._rot.on = false;
    });
  }

  update(dt) {
    if (this._moved) this.active = true;
    this._moved = false;
    const stage = this.stage;
    stage.screenToWindow(this._sx, this._sy, _w);
    this.nx = _w.x;
    this.ny = _w.y;
    this.z += (this.depth - this.z) * damp(12, dt);
    stage.unproject(this.nx, this.ny, this.z, this.pos);

    this.pinch = this._button;
    this.pinchDown = this.pinch && !this._prevPinch;
    this.pinchUp = !this.pinch && this._prevPinch;
    this._prevPinch = this.pinch;
    this.charge += ((this.pinch ? 1 : 0) - this.charge) * damp(16, dt);

    if (this._has && dt > 0) {
      _v.subVectors(this.pos, this._prev).divideScalar(dt);
      this.vel.lerp(_v, damp(18, dt));
    }
    this._prev.copy(this.pos);
    this._has = true;

    this.rotate = this._rot.on || this._rot.dx || this._rot.dy ? { dx: this._rot.dx, dy: this._rot.dy } : null;
    this._rot.dx = 0;
    this._rot.dy = 0;
    this.breakNow = this._break;
    this._break = false;

    // arrow keys: lean the virtual head; springs back to centre on release
    const k = this._keys;
    const tx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const ty = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    const rate = damp(tx || ty ? 3.5 : 2.2, dt);
    this.head.x += (tx - this.head.x) * rate;
    this.head.y += (ty - this.head.y) * rate;
  }

  /** Take the accumulated temperature wheel delta. */
  takeWheel() {
    const w = this.wheelTemp;
    this.wheelTemp = 0;
    return w;
  }
}

const _w = new THREE.Vector2();
const _v = new THREE.Vector3();
