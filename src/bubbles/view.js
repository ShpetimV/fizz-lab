import * as THREE from 'three';
import { bubbleVert, bubbleFrag } from '../shaders/bubbles.js';
import { BUBBLES } from './sim.js';

/** Instanced soap bubbles, drawn with additive blending (no sorting needed). */
export class BubbleView {
  constructor(stage) {
    const bg = stage.bgUniforms;
    const base = new THREE.SphereGeometry(1, 40, 28);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    const cap = BUBBLES.MAX + 2;
    this.posR = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.film = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPosR', this.posR);
    geo.setAttribute('iFilm', this.film);
    geo.instanceCount = 0;
    this.geometry = geo;
    this.cap = cap;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: bubbleVert,
        fragmentShader: bubbleFrag,
        uniforms: { uVideo: bg.uVideo, uHasVideo: bg.uHasVideo, uCover: bg.uCover, uWindow: bg.uWindow, uTime: bg.uTime, uDim: bg.uDim },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  update(sim, alpha) {
    let n = 0;
    const pr = this.posR.array;
    const f = this.film.array;
    for (const b of sim.bubbles) {
      if (n >= this.cap) break;
      pr[n * 4] = b.p[0];
      pr[n * 4 + 1] = b.p[1];
      pr[n * 4 + 2] = b.p[2];
      pr[n * 4 + 3] = b.r;
      f[n * 4] = sim.thickness(b);
      f[n * 4 + 1] = b.seed;
      f[n * 4 + 2] = b.held ? 1.6 : 1;
      f[n * 4 + 3] = alpha * Math.min(1, (sim.time - b.born) / 0.15 + 0.2);
      n++;
    }
    this.geometry.instanceCount = n;
    for (const a of [this.posR, this.film]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.mesh.visible = n > 0 && alpha > 0.01;
  }
}
