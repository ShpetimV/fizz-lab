import * as THREE from 'three';
import { liquidVert, liquidFrag, MAX_CELLS, MAX_POKES } from '../shaders/liquid.js';
import { VIEW } from '../config.js';

const _m = new THREE.Matrix4();

/** Full-screen ray-marching pass for the liquid (only pixels inside its bounding sphere do real work). */
export class LiquidView {
  constructor(stage) {
    this.stage = stage;
    const bg = stage.bgUniforms;
    this.uniforms = {
      uVideo: bg.uVideo,
      uHasVideo: bg.uHasVideo,
      uCover: bg.uCover,
      uWindow: bg.uWindow,
      uTime: bg.uTime,
      uDim: bg.uDim,
      uRes: stage.res,
      uInvVP: { value: new THREE.Matrix4() },
      uVP: { value: new THREE.Matrix4() },
      uEye: { value: new THREE.Vector3() },
      uCells: { value: Array.from({ length: MAX_CELLS }, () => new THREE.Vector4()) },
      uCount: { value: 0 },
      uPokes: { value: Array.from({ length: MAX_POKES }, () => new THREE.Vector4()) },
      uPokeCount: { value: 0 },
      uBound: { value: new THREE.Vector4(0, 0, 0, 1) },
      uSpike: { value: new THREE.Vector4(0, 0, 0, 1) },
      uMagnet: { value: new THREE.Vector4() },
      uTint: { value: new THREE.Vector3(0.86, 0.87, 0.89) },
      uMetal: { value: 1 },
      uRough: { value: 0 },
      uHeat: { value: 0 },
      uPixel: { value: 0.001 },
      uAlpha: { value: 1 },
      uSteps: { value: 96 },
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: liquidVert,
        fragmentShader: liquidFrag,
        uniforms: this.uniforms,
        transparent: true,
        depthTest: true,
        depthWrite: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0.5; // after the backdrop, before dust, hands and effects
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  /**
   * @param sim     LiquidSim
   * @param look    { tint, metal, rough, heat } (already blended between materials)
   * @param pokes   [{ p: [x,y,z], r }]
   * @param magnet  { p: [x,y,z], amount 0..1 } or null
   * @param scale   0..1 grows the liquid in / shrinks it away
   */
  update({ sim, look, pokes, magnet, scale, alpha, steps }) {
    const u = this.uniforms;
    const cam = this.stage.camera;
    u.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    _m.copy(cam.matrixWorld).invert();
    u.uVP.value.multiplyMatrices(cam.projectionMatrix, _m);
    u.uEye.value.copy(this.stage.eye);
    u.uPixel.value = (2 * VIEW.halfH) / VIEW.dist / Math.max(1, this.stage.res.value.y);
    u.uSteps.value = steps;
    u.uAlpha.value = alpha;

    let n = 0;
    for (const c of sim.cells) {
      if (!sim.active(c) || n >= MAX_CELLS) continue;
      u.uCells.value[n++].set(c.p[0], c.p[1], c.p[2], c.r * scale);
    }
    u.uCount.value = n;
    let k = 0;
    for (const pk of pokes) {
      if (k >= MAX_POKES) break;
      u.uPokes.value[k++].set(pk.p[0], pk.p[1], pk.p[2], pk.r);
    }
    u.uPokeCount.value = k;

    const b = sim.bounds3();
    const spike = magnet && magnet.amount > 0.002 ? sim.dropNear(magnet.p) : null;
    if (b) u.uBound.value.set(b.centre[0], b.centre[1], b.centre[2], b.radius * scale + 0.25 + (spike ? spike.radius * 0.7 : 0));
    if (spike) {
      u.uSpike.value.set(spike.centre[0], spike.centre[1], spike.centre[2], spike.radius);
      u.uMagnet.value.set(magnet.p[0], magnet.p[1], magnet.p[2], magnet.amount);
    } else u.uMagnet.value.w = 0;

    u.uTint.value.set(...look.tint);
    u.uMetal.value = look.metal;
    u.uRough.value = look.rough;
    u.uHeat.value = look.heat;
    this.mesh.visible = n > 0 && alpha > 0.01;
  }

  hide() {
    this.mesh.visible = false;
  }
}
