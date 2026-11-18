import * as THREE from 'three';
import { glassVert, glassFrag } from '../shaders/scene.js';

/**
 * A frosted-glass pane in the 3D scene: rounded, softly shadowed, showing a
 * blurred copy of the room behind it. Used for the element dock and the info
 * card, so the in-scene windows match the DOM ones.
 */
export class GlassPanel {
  constructor(stage, { renderOrder = 5, depthTest = true, map = null, tint = [0.05, 0.05, 0.07] } = {}) {
    const bg = stage.bgUniforms;
    this.uniforms = {
      uVideo: bg.uVideo,
      uHasVideo: bg.uHasVideo,
      uCover: bg.uCover,
      uWindow: bg.uWindow,
      uTime: bg.uTime,
      uDim: bg.uDim,
      uRes: stage.res,
      uBlur: stage.blur,
      uSize: { value: new THREE.Vector2(1, 1) },
      uMargin: { value: 0.5 },
      uRadius: { value: 0.2 },
      uAlpha: { value: 1 },
      uTint: { value: new THREE.Vector3(...tint) },
      uMap: { value: map },
      uHasMap: { value: map ? 1 : 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: glassVert,
        fragmentShader: glassFrag,
        uniforms: this.uniforms,
        transparent: true,
        depthTest,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  /** Pane size and corner radius in world units. */
  setSize(width, height, radius) {
    this.uniforms.uSize.value.set(width, height);
    this.uniforms.uRadius.value = Math.min(radius, width / 2, height / 2);
  }

  set alpha(a) {
    this.uniforms.uAlpha.value = a;
    this.mesh.visible = a > 0.01;
  }

  get alpha() {
    return this.uniforms.uAlpha.value;
  }
}
