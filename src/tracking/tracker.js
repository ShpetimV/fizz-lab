import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';

/* global __MP_VERSION__ */
const BASE = `${import.meta.env.BASE_URL}mediapipe`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MP_VERSION__}/wasm`;
const CDN_MODELS = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

// MediaPipe's WASM runtime writes its routine log lines ("INFO: Created TensorFlow
// Lite XNNPACK delegate…", glog-style "W1110 …" notices) through console.error /
// console.warn. They are not errors; move them to console.debug so real problems
// stay visible.
const MP_NOISE = /^(INFO: |[IW]\d{4} \d\d:\d\d:\d\d)/;
function quietMediaPipeLogs() {
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      if (typeof args[0] === 'string' && MP_NOISE.test(args[0])) console.debug('[mediapipe]', ...args);
      else original(...args);
    };
  }
}

// Local copies (public/mediapipe, created by `npm run setup`) are preferred so
// the app works offline; if one is missing we fall back to the CDN.
async function pick(localUrl, remoteUrl) {
  try {
    const res = await fetch(localUrl, { method: 'HEAD' });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('text/html')) return localUrl;
  } catch {
    /* fall through */
  }
  return remoteUrl;
}

/**
 * Owns the webcam and the two MediaPipe landmarkers. Detection only runs when
 * the camera has delivered a new frame, and the (cheaper to skip) face model
 * runs on every third frame so tracking never starves rendering.
 */
export class Tracker {
  constructor(video) {
    this.video = video;
    this.cameraOn = false;
    this.ready = false;
    this.handLandmarker = null;
    this.faceLandmarker = null;
    this.hands = null; // latest HandLandmarkerResult
    this.face = null; // latest face landmark array (or null)
    this.handsStamp = 0; // increments with every new hand result
    this.faceStamp = 0;
    this.detectMs = 0;
    this.trackFps = 0;
    this._newFrame = false;
    this._frameIndex = 0;
    this._lastTs = 0;
    this._lastVideoTime = -1;
    this._lastDetect = 0;
    this._failed = false;
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const video = this.video;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
    }
    this.cameraOn = true;
    if ('requestVideoFrameCallback' in video) {
      const onFrame = () => {
        this._newFrame = true;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
  }

  async loadModels(log = () => {}) {
    quietMediaPipeLogs();
    const wasmLocal = await pick(`${BASE}/wasm/vision_wasm_internal.wasm`, null);
    const fileset = await FilesetResolver.forVisionTasks(wasmLocal ? `${BASE}/wasm` : CDN_WASM);
    log(`vision runtime · ${wasmLocal ? 'local' : 'cdn'}`);

    const create = async (Task, modelUrl, options) => {
      const base = { modelAssetPath: modelUrl };
      try {
        return await Task.createFromOptions(fileset, { baseOptions: { ...base, delegate: 'GPU' }, ...options });
      } catch (err) {
        console.warn('[tracker] GPU delegate failed, using CPU', err);
        return Task.createFromOptions(fileset, { baseOptions: { ...base, delegate: 'CPU' }, ...options });
      }
    };

    this.handLandmarker = await create(HandLandmarker, await pick(`${BASE}/models/hand_landmarker.task`, CDN_MODELS.hand), {
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
    log('hand landmarker · 2 hands · online');

    this.faceLandmarker = await create(FaceLandmarker, await pick(`${BASE}/models/face_landmarker.task`, CDN_MODELS.face), {
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    log('face landmarker · online');
    this.ready = true;
  }

  /** Call once per render frame. Returns true when new hand data arrived. */
  update(nowMs) {
    if (!this.ready || !this.cameraOn || this._failed) return false;
    const video = this.video;
    if (video.readyState < 2) return false;
    // new camera frame?
    if ('requestVideoFrameCallback' in video) {
      if (!this._newFrame) return false;
      this._newFrame = false;
    } else {
      if (video.currentTime === this._lastVideoTime) return false;
      this._lastVideoTime = video.currentTime;
    }
    const ts = Math.max(nowMs, this._lastTs + 1); // timestamps must strictly increase
    this._lastTs = ts;
    const t0 = performance.now();
    try {
      this.hands = this.handLandmarker.detectForVideo(video, ts);
      this.handsStamp++;
      if (this._frameIndex++ % 3 === 0) {
        const res = this.faceLandmarker.detectForVideo(video, ts);
        this.face = res.faceLandmarks && res.faceLandmarks.length ? res.faceLandmarks[0] : null;
        this.faceStamp++;
      }
    } catch (err) {
      console.error('[tracker] detection failed, tracking disabled', err);
      this._failed = true;
      return false;
    }
    const t1 = performance.now();
    this.detectMs += (t1 - t0 - this.detectMs) * 0.1;
    if (this._lastDetect) this.trackFps += (1000 / Math.max(1, t1 - this._lastDetect) - this.trackFps) * 0.1;
    this._lastDetect = t1;
    return true;
  }
}
