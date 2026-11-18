import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VIEW, QUALITY } from '../config.js';
import { backgroundVert, backgroundFrag } from '../shaders/scene.js';
import { FinalShader } from '../shaders/post.js';

// The whole pipeline is display-referred (colours are authored as they should
// appear), so three's colour management is switched off.
THREE.ColorManagement.enabled = false;

/**
 * Renderer + off-axis "window" camera + post-processing.
 *
 * The webcam image is the window plane at z = 0. The camera never rotates; the
 * viewer's eye translates and the frustum is skewed so the window stays glued
 * to the screen while everything in front of / behind it shifts in parallax.
 */
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, VIEW.near, VIEW.far);
    this.camera.matrixAutoUpdate = true;

    this.width = 1;
    this.height = 1;
    this.halfW = VIEW.halfH;
    this.eye = new THREE.Vector3(0, 0, VIEW.dist);
    this.zoom = 1; // window scale: < 1 pushes in
    this.focus = new THREE.Vector2(0, 0); // window centre in world units
    this.videoAspect = 16 / 9;
    this.cover = new THREE.Vector2(1, 1);
    this.pointScale = 1;
    this.quality = QUALITY.high;

    // --- webcam / fallback backdrop (full-screen triangle inside the scene)
    const bgGeo = new THREE.BufferGeometry();
    bgGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.bgUniforms = {
      uVideo: { value: null },
      uHasVideo: { value: 0 },
      uCover: { value: this.cover },
      uWindow: { value: new THREE.Vector3(0, 0, 1) },
      uTime: { value: 0 },
      uDim: { value: 0.0 },
    };
    // shared with the glass panels, which re-sample the backdrop in screen space
    this.res = { value: new THREE.Vector2(1, 1) };
    this.blur = { value: 1 };
    this.background = new THREE.Mesh(
      bgGeo,
      new THREE.ShaderMaterial({
        vertexShader: backgroundVert,
        fragmentShader: backgroundFrag,
        uniforms: this.bgUniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.background.frustumCulled = false;
    this.background.renderOrder = -1000;
    this.scene.add(this.background);
    this.dimTarget = 0.6;

    // --- post chain
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.7, 0.5);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.setQuality('high');
    this.resize();
  }

  setQuality(key) {
    this.quality = QUALITY[key];
    this.qualityKey = key;
    const q = this.quality;
    this.bloom.strength = q.bloomStrength;
    this.bloom.radius = q.bloomRadius;
    this.bloom.threshold = q.bloomThreshold;
    this.blur.value = q.post;
    // multisampled scene buffer: clean silhouettes on the solid atoms
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== q.msaa) {
        rt.samples = q.msaa;
        rt.dispose();
      }
    }
    this.resize();
  }

  setVideo(video) {
    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.bgUniforms.uVideo.value = tex;
    this.bgUniforms.uHasVideo.value = 1;
    this.videoAspect = video.videoWidth / Math.max(1, video.videoHeight);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.res.value.set(this.composer.renderTarget1.width, this.composer.renderTarget1.height);
    const aspect = w / h;
    this.halfW = VIEW.halfH * aspect;
    this.final.uniforms.uAspect.value = aspect;
    // object-fit: cover for the video
    if (aspect > this.videoAspect) this.cover.set(1, this.videoAspect / aspect);
    else this.cover.set(aspect / this.videoAspect, 1);
    // world size -> gl_PointSize factor (independent of zoom, see updateCamera)
    this.pointScale = (VIEW.dist / VIEW.halfH) * (h * pr * 0.5);
    this.updateCamera();
  }

  get aspect() {
    return this.width / this.height;
  }

  /** Off-axis frustum through the (zoomed, re-centred) window at z = 0. */
  updateCamera() {
    const s = this.zoom;
    const ez = VIEW.dist * s;
    this.eye.z = ez;
    const hw = this.halfW * s;
    const hh = VIEW.halfH * s;
    const k = VIEW.near / ez;
    const cx = this.focus.x;
    const cy = this.focus.y;
    const cam = this.camera;
    cam.position.copy(this.eye);
    cam.quaternion.identity();
    cam.projectionMatrix.makePerspective(
      (cx - hw - this.eye.x) * k,
      (cx + hw - this.eye.x) * k,
      (cy + hh - this.eye.y) * k,
      (cy - hh - this.eye.y) * k,
      VIEW.near,
      VIEW.far,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);
    this.bgUniforms.uWindow.value.set(cx / (2 * this.halfW), cy / (2 * VIEW.halfH), s);
  }

  /**
   * World position of the point that appears at window coords (nx, ny) in
   * [-1, 1] (un-zoomed webcam frame) when placed at depth z.
   */
  unproject(nx, ny, z, out) {
    const e = this.eye;
    const t = (e.z - z) / e.z;
    out.x = e.x + (nx * this.halfW - e.x) * t;
    out.y = e.y + (ny * VIEW.halfH - e.y) * t;
    out.z = z;
    return out;
  }

  /** Inverse of unproject: window coords of a world point (z returned as depth). */
  project(p, out) {
    const e = this.eye;
    const t = e.z / Math.max(0.05, e.z - p.z);
    out.x = (e.x + (p.x - e.x) * t) / this.halfW;
    out.y = (e.y + (p.y - e.y) * t) / VIEW.halfH;
    out.z = t; // perspective scale at that depth (1 on the window plane)
    return out;
  }

  /** Actual screen NDC -> window coords (differs only while the camera pushes in). */
  screenToWindow(sx, sy, out) {
    out.x = (this.focus.x + sx * this.halfW * this.zoom) / this.halfW;
    out.y = (this.focus.y + sy * VIEW.halfH * this.zoom) / VIEW.halfH;
    return out;
  }

  windowToScreen(nx, ny, out) {
    out.x = (nx * this.halfW - this.focus.x) / (this.halfW * this.zoom);
    out.y = (ny * VIEW.halfH - this.focus.y) / (VIEW.halfH * this.zoom);
    return out;
  }

  render(time, dt) {
    const bg = this.bgUniforms;
    bg.uTime.value = time;
    bg.uDim.value += (this.dimTarget - bg.uDim.value) * Math.min(1, dt * 1.5);
    this.final.uniforms.uTime.value = time;
    this.updateCamera();
    this.composer.render(dt);
  }
}
