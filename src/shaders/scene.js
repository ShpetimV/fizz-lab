// GLSL for everything that lives inside the 3D scene.
// Solids (atoms, bonds) are opaque and lit like studio product shots; guides,
// rings and sparkles are thin additive light; panels are frosted glass.

// ---------------------------------------------------------------- backdrop
// The room behind everything: the mirrored webcam image, or a slow colour
// "wallpaper" when there is no camera. Shared by the background pass and by the
// glass panels, which blur it.
export const BACKDROP = /* glsl */ `
uniform sampler2D uVideo;
uniform float uHasVideo;
uniform vec2 uCover;      // fraction of the video visible in x / y (object-fit: cover)
uniform vec3 uWindow;     // xy = window centre offset (uv units), z = zoom scale
uniform float uTime;
uniform float uDim;

float bdLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float bdBlob(vec2 p, vec2 c, float r) {
  vec2 d = (p - c) / r;
  return exp(-dot(d, d));
}

vec3 wallpaper(vec2 suv) {
  vec2 p = suv - 0.5;
  float t = uTime * 0.07;
  vec3 col = vec3(0.045, 0.045, 0.062);
  col += vec3(1.0, 0.22, 0.37) * bdBlob(p, vec2(-0.42 + 0.10 * sin(t * 1.3), 0.30 + 0.08 * cos(t * 0.9)), 0.42) * 0.34;
  col += vec3(0.75, 0.35, 0.95) * bdBlob(p, vec2(0.38 + 0.09 * cos(t * 1.1), 0.34 + 0.07 * sin(t * 1.4)), 0.46) * 0.30;
  col += vec3(0.04, 0.52, 1.0) * bdBlob(p, vec2(0.46 + 0.08 * sin(t * 0.8 + 2.0), -0.30 + 0.09 * cos(t * 1.2)), 0.50) * 0.30;
  col += vec3(1.0, 0.62, 0.04) * bdBlob(p, vec2(-0.48 + 0.07 * cos(t + 1.0), -0.36 + 0.08 * sin(t * 0.7)), 0.40) * 0.22;
  col += vec3(0.25, 0.85, 0.75) * bdBlob(p, vec2(0.02 + 0.16 * sin(t * 0.6), -0.52), 0.36) * 0.16;
  // keep the middle of the room calm so molecules read clearly
  col *= 0.55 + 0.45 * smoothstep(0.05, 0.6, length(p * vec2(1.0, 1.25)));
  return col;
}

vec3 backdrop(vec2 screenUv) {
  vec2 suv = (screenUv - 0.5) * uWindow.z + 0.5 + uWindow.xy;   // camera push-in
  if (uHasVideo > 0.5) {
    vec2 uv = (suv - 0.5) * uCover + 0.5;
    uv.x = 1.0 - uv.x;                                          // mirror
    vec3 v = texture2D(uVideo, uv).rgb;
    v = mix(vec3(bdLuma(v)), v, 0.94);
    v = pow(v, vec3(1.06));
    return v * uDim;
  }
  return wallpaper(suv) * (0.45 + uDim * 0.9);
}`;

// What shiny things reflect: the room (webcam) plus a few studio softboxes, so
// chrome reads as chrome even in a dim room. Directions are in world space,
// which equals view space here because the camera never rotates.
export const ENVIRONMENT = /* glsl */ `
vec3 studio(vec3 R) {
  // a long softbox overhead, a slim strip light on the right, a faint fill on the left
  float top = smoothstep(0.8, 0.86, R.y) * (1.0 - smoothstep(0.22, 0.3, abs(R.x + 0.1))) * (1.0 - smoothstep(0.35, 0.45, abs(R.z - 0.2)));
  float side = smoothstep(0.9, 0.94, R.x) * (1.0 - smoothstep(0.32, 0.4, abs(R.y - 0.05)));
  float fill = smoothstep(0.9, 0.95, -R.x) * (1.0 - smoothstep(0.08, 0.16, abs(R.y + 0.05)));
  float floorBounce = smoothstep(-0.2, -0.85, R.y) * 0.04;
  return vec3(1.0) * top * 1.8 + vec3(1.0, 0.97, 0.93) * side * 1.3 + vec3(0.86, 0.92, 1.0) * fill * 0.6
    + vec3(0.9, 0.85, 0.8) * floorBounce;
}

vec3 room(vec3 R) {
  // toward the viewer: the webcam sees exactly that side of the room; away: the room behind, dimmer
  vec2 uv = R.z > 0.0 ? 0.5 + R.xy / (1.0 + R.z) * 0.5 : 0.5 + R.xy * 0.45;
  vec3 c = backdrop(clamp(uv, 0.0, 1.0)) / max(uDim, 0.25);
  if (uHasVideo < 0.5) {
    // no camera: a neutral photo studio (bright sky, dark floor, a soft horizon) tinted by the wallpaper
    float y = R.y;
    vec3 sky = mix(vec3(0.32, 0.33, 0.36), vec3(0.78, 0.8, 0.84), smoothstep(0.0, 0.9, y));
    vec3 ground = mix(vec3(0.16, 0.16, 0.17), vec3(0.04, 0.04, 0.045), smoothstep(0.0, -0.6, y));
    vec3 studioRoom = mix(ground, sky, smoothstep(-0.03, 0.03, y)) + vec3(0.35) * exp(-y * y * 600.0);
    c = mix(studioRoom, c, 0.3);
  }
  c *= R.z > 0.0 ? 0.95 : 0.6;
  c += vec3(0.035, 0.035, 0.045) * (0.6 + 0.4 * R.y);
  return c + studio(R);
}`;

export const backgroundVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

export const backgroundFrag = /* glsl */ `
precision highp float;
${BACKDROP}
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(backdrop(vUv), 1.0);
}`;

// ---------------------------------------------------------------- glass panels
// A rounded pane that shows a blurred, slightly saturated copy of the backdrop,
// with a light hairline rim and a soft drop shadow. Optional content texture.
export const glassVert = /* glsl */ `
uniform vec2 uSize;
uniform float uMargin;
varying vec2 vP;
void main() {
  vP = position.xy * (uSize + 2.0 * uMargin);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 0.0, 1.0);
}`;

export const glassFrag = /* glsl */ `
precision highp float;
${BACKDROP}
uniform vec2 uRes;
uniform vec2 uSize;       // pane width / height (world units)
uniform float uRadius;
uniform float uAlpha;
uniform float uBlur;      // 0 = cheap single tap
uniform vec3 uTint;
uniform sampler2D uMap;
uniform float uHasMap;
varying vec2 vP;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 frosted(vec2 suv) {
  if (uHasVideo < 0.5 || uBlur < 0.5) return backdrop(suv);
  // 14-tap spiral, rotated per pixel so the pattern dissolves into grain
  float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  vec2 aspect = vec2(uRes.y / uRes.x, 1.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    float f = (float(i) + 0.5) / 14.0;
    float a = float(i) * 2.3999632 + rot;
    acc += backdrop(suv + vec2(cos(a), sin(a)) * sqrt(f) * 0.03 * aspect);
  }
  return acc / 14.0;
}

void main() {
  float d = sdRoundRect(vP, uSize * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-4);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float shadow = exp(-pow(max(d, 0.0) / 0.22, 2.0)) * 0.3 * (1.0 - inside);
  if (inside + shadow < 0.004) discard;

  vec3 bg = frosted(gl_FragCoord.xy / uRes);
  bg = mix(vec3(bdLuma(bg)), bg, 1.3);
  // without the blur (low quality) the pane goes darker so text stays readable
  vec3 col = bg * (uBlur < 0.5 && uHasVideo > 0.5 ? 0.24 : 0.6) + uTint;
  vec2 q = vP / uSize;                       // -0.5 .. 0.5
  col += vec3(1.0) * (0.035 + 0.05 * (q.y + 0.5));
  // hairline rim, catching light along the top edge
  float rim = 1.0 - smoothstep(0.0, aa * 1.6, abs(d + aa * 1.2));
  col += vec3(1.0) * rim * (0.16 + 0.42 * smoothstep(-0.2, 0.5, q.y));

  if (uHasMap > 0.5) {
    vec4 t = texture2D(uMap, q + 0.5);
    col = mix(col, t.rgb, t.a);
  }
  float a = inside * uAlpha * 0.94 + shadow * uAlpha;
  gl_FragColor = vec4(col * inside, a);
}`;

// ---------------------------------------------------------------- atoms
// Glossy, toy-like spheres: half-lambert body, a broad overhead softbox, a tight
// key reflection and a milky rim. View space equals world space here (the
// camera never rotates), so lights are fixed in the room.
export const LIGHTING = /* glsl */ `
vec3 shade(vec3 base, vec3 N, vec3 V, float gloss) {
  vec3 L = normalize(vec3(-0.42, 0.74, 0.54));
  float wrap = dot(N, L) * 0.5 + 0.5;
  wrap *= wrap;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 R = reflect(-V, N);
  float rl = max(dot(R, L), 0.0);
  float softbox = smoothstep(0.3, 0.95, R.y) * 0.16;
  float key = pow(rl, 110.0) * 0.95 + pow(rl, 14.0) * 0.14;
  vec3 col = base * (0.3 + 0.76 * wrap);
  col += base * max(-N.y, 0.0) * 0.1;                 // light bounced from below
  col = mix(col, vec3(1.0), fres * 0.22);
  col += vec3(1.0) * (softbox + key) * gloss;
  return col;
}`;

export const atomVert = /* glsl */ `
attribute vec4 iPosR;     // xyz position, w radius
attribute vec3 iColor;
attribute vec4 iParams;   // x seed, y flash, z alert, w unused
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
varying vec4 vParams;
void main() {
  vec4 mv = viewMatrix * vec4(iPosR.xyz + position * iPosR.w, 1.0);
  vN = mat3(viewMatrix) * normal;
  vView = -mv.xyz;
  vColor = iColor;
  vParams = iParams;
  gl_Position = projectionMatrix * mv;
}`;

export const atomFrag = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
varying vec4 vParams;
${LIGHTING}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  float seed = vParams.x;
  float flash = vParams.y;
  float alert = clamp(vParams.z, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec3 col = shade(vColor, N, V, 0.8);
  // pearl edge: a whisper of colour that shifts as the atom or your head moves
  float edge = pow(1.0 - ndv, 2.4);
  vec3 pearl = 0.5 + 0.5 * cos(6.2831853 * (edge * 0.9 + N.y * 0.25 + seed + vec3(0.0, 0.33, 0.67)));
  col += pearl * edge * 0.16;

  col = mix(col, vec3(1.0), flash * 0.38);
  vec3 warn = vec3(1.0, 0.27, 0.23) * (0.55 + 0.45 * (1.0 - ndv));
  col = mix(col, warn + col * 0.3, alert * (0.75 + 0.25 * sin(uTime * 14.0)));

  // depth cue: things farther from the viewer sink slightly into the room
  col *= mix(1.0, 0.6, smoothstep(9.5, 15.0, length(vView)));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- bond sticks
// One glossy stick per shared electron pair: pale, lightly tinted by the atom at
// each end, with a slow sheen sliding along it.
export const tubeVert = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec4 iColorA;   // rgb, radius
attribute vec4 iColorB;   // rgb, flash
attribute float iSeed;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColorA;
varying vec3 vColorB;
varying vec3 vData;       // along 0..1, length, flash
varying float vSeed;
void main() {
  vec3 axis = iEnd - iStart;
  float len = max(length(axis), 1e-4);
  vec3 d = axis / len;
  vec3 up = abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 s = normalize(cross(d, up));
  vec3 t = cross(d, s);
  vec3 radial = s * position.x + t * position.z;
  vec3 p = iStart + d * (position.y * len) + radial * iColorA.w;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vN = mat3(viewMatrix) * radial;
  vView = -mv.xyz;
  vColorA = iColorA.rgb;
  vColorB = iColorB.rgb;
  vData = vec3(position.y, len, iColorB.w);
  vSeed = iSeed;
  gl_Position = projectionMatrix * mv;
}`;

export const tubeFrag = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColorA;
varying vec3 vColorB;
varying vec3 vData;
varying float vSeed;
${LIGHTING}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  vec3 tint = mix(vColorA, vColorB, smoothstep(0.42, 0.58, vData.x));
  vec3 base = mix(vec3(0.9, 0.91, 0.94), tint, 0.38);
  vec3 col = shade(base, N, V, 0.55);
  float f = fract(vData.x * 0.6 - uTime * 0.28 + vSeed);
  col += vec3(1.0) * exp(-pow((f - 0.5) * 6.0, 2.0)) * 0.16;
  col = mix(col, vec3(1.0), vData.z * 0.5);
  col *= mix(1.0, 0.6, smoothstep(9.5, 15.0, length(vView)));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- orbit rings
export const ringVert = /* glsl */ `
attribute vec4 iCentre;   // xyz, radius
attribute vec3 iU;
attribute vec3 iV;
attribute vec4 iColor;
varying vec4 vColor;
void main() {
  vec3 n = cross(iU, iV);
  vec3 p = iCentre.xyz + (iU * position.x + iV * position.y + n * position.z) * iCentre.w;
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

export const ringFrag = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

// ---------------------------------------------------------------- lines
// Camera-facing ribbons: hand rig, guides, dashes, the elastic strand that
// forms between two atoms about to bond.
export const beamVert = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec4 iColorA;
attribute vec4 iColorB;
attribute vec4 iData;     // x width, y mode, z seed, w flash
varying vec2 vUv;
varying float vLen;
varying vec4 vColorA;
varying vec4 vColorB;
varying vec4 vData;
void main() {
  vec3 a = (viewMatrix * vec4(iStart, 1.0)).xyz;
  vec3 b = (viewMatrix * vec4(iEnd, 1.0)).xyz;
  vec3 dir = b - a;
  vec3 p = mix(a, b, position.x);
  vec3 side = cross(dir, p);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = iData.x * (1.0 + iData.w * 1.6);
  p += side * position.y * w * 3.0;
  vUv = position.xy;
  vLen = length(dir);
  vColorA = iColorA;
  vColorB = iColorB;
  vData = iData;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

export const beamFrag = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec2 vUv;
varying float vLen;
varying vec4 vColorA;
varying vec4 vColorB;
varying vec4 vData;
void main() {
  float d = abs(vUv.y) * 3.0;
  float core = exp(-d * d * 3.6);
  float s = vUv.x * vLen;
  float mode = vData.y;
  float seed = vData.z;
  vec4 c = mix(vColorA, vColorB, smoothstep(0.15, 0.85, vUv.x));
  float m = 1.0;
  if (mode > 0.5 && mode < 1.5) {
    // flowing link: soft beads of light drifting both ways
    float f1 = fract(s * 0.7 - uTime * 0.8 + seed);
    float f2 = fract(s * 0.7 + uTime * 0.6 + seed * 1.7 + 0.5);
    m = 0.55 + exp(-pow((f1 - 0.5) * 6.0, 2.0)) * 0.6 + exp(-pow((f2 - 0.5) * 6.0, 2.0)) * 0.4;
    m *= smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
  } else if (mode > 1.5 && mode < 2.5) {
    // marching round-capped dashes
    float f = abs(fract(s * 3.0 - uTime * 0.9 + seed) - 0.5);
    m = 1.0 - smoothstep(0.24, 0.3, f);
  }
  gl_FragColor = vec4(c.rgb, core * m * c.a * (1.0 + vData.w));
}`;

// ---------------------------------------------------------------- billboards
export const billboardVert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iData;     // x size, y mode, z p1, w p2
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vData;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iData.x;
  vUv = position.xy;
  vColor = iColor;
  vData = iData;
  gl_Position = projectionMatrix * mv;
}`;

export const billboardFrag = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vData;
void main() {
  float r = length(vUv);
  float mode = vData.y;
  float a = 0.0;
  if (mode < 0.5) {
    // DOT: a clean disc with the faintest halo
    a = (1.0 - smoothstep(0.42, 0.52, r)) + exp(-r * r * 5.0) * 0.12 * (1.0 - smoothstep(0.8, 1.0, r));
  } else if (mode < 1.5) {
    // RING: p1 radius, p2 thickness
    float d = (r - vData.z) / vData.w;
    a = exp(-d * d) * (1.0 - smoothstep(0.92, 1.0, r));
  } else if (mode < 2.5) {
    // GLYPH from the label atlas: p1 = cell index
    float cx = mod(vData.z, uGrid.x);
    float cy = floor(vData.z / uGrid.x);
    vec2 uv = vUv * 0.5 + 0.5;
    vec2 auv = vec2((cx + uv.x) / uGrid.x, 1.0 - (cy + 1.0 - uv.y) / uGrid.y);
    a = texture2D(uAtlas, auv).r;
  } else if (mode < 3.5) {
    // TURN: a faint circle with two arcs chasing each other (two-hand rotate). p1 = phase
    float ang = atan(vUv.y, vUv.x);
    float t = uTime * 1.6 + vData.z;
    float ring = exp(-pow((r - 0.8) * 70.0, 2.0)) * 0.3;
    float arcs = exp(-pow((r - 0.8) * 34.0, 2.0)) * smoothstep(0.35, 0.6, sin(ang * 2.0 - t));
    a = ring + arcs;
  } else if (mode < 4.5) {
    // SPARKLE: four-point star, p1 = turn
    float cs = cos(vData.z), sn = sin(vData.z);
    vec2 p = abs(mat2(cs, -sn, sn, cs) * vUv);
    float star = pow(p.x, 0.55) + pow(p.y, 0.55);
    a = 1.0 - smoothstep(0.8, 0.9, star);
  } else {
    // NODE: small solid point (joints, anchors)
    a = 1.0 - smoothstep(0.55, 0.75, r);
  }
  gl_FragColor = vec4(vColor.rgb, a * vColor.a);
}`;

// ---------------------------------------------------------------- points
// Shared fragment for every point sprite: a crisp disc with a soft edge.
export const pointFrag = /* glsl */ `
precision highp float;
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = smoothstep(1.0, 0.62, r2);
  vec3 col = mix(vColor.rgb, vec3(1.0), smoothstep(0.35, 0.0, length(p - vec2(-0.25, -0.3))) * 0.45);
  gl_FragColor = vec4(col, a * vColor.a);
}`;

// CPU-positioned points (electrons and their trails).
export const electronVert = /* glsl */ `
attribute vec4 aColor;    // rgb, alpha
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;

// Stateless GPU particles: every particle is fully described by its spawn
// attributes; the vertex shader integrates the motion from uTime alone.
export const particleVert = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aTime;     // birth, life, mode, seed
attribute vec4 aColor;    // rgb, size
uniform float uTime;
uniform float uScale;
varying vec4 vColor;

vec3 hash3(float n) {
  return fract(sin(vec3(n * 12.9898, n * 78.233, n * 37.719)) * 43758.5453) * 2.0 - 1.0;
}

void main() {
  float t = (uTime - aTime.x) / aTime.y;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec4(0.0);
    return;
  }
  float mode = aTime.z;
  float seed = aTime.w;
  vec3 p;
  float fade;
  float grow = 1.0;
  if (mode < 0.5) {
    // burst with drag; aEnd is the total displacement
    float k = 1.0 - exp(-t * 3.2);
    p = aStart + aEnd * k * 1.04;
    p += hash3(seed * 91.7) * 0.12 * sin(t * 9.0 + seed * 30.0) * t;
    fade = (1.0 - t) * (1.0 - t);
  } else if (mode < 1.5) {
    // converge on aEnd along a tightening spiral
    float e = t * t * (3.0 - 2.0 * t);
    e *= e;
    vec3 d = aStart - aEnd;
    float ang = (1.0 - e) * 3.4 * (seed > 0.5 ? 1.0 : -1.0);
    float c = cos(ang), s = sin(ang);
    d.xy = mat2(c, -s, s, c) * d.xy;
    p = aEnd + d * (1.0 - e);
    fade = smoothstep(0.0, 0.25, t) * (0.35 + 0.65 * e) * (1.0 - smoothstep(0.93, 1.0, t));
  } else if (mode < 2.5) {
    // shatter then reform: fly out through a random control point, land on aEnd
    vec3 mid = aStart + hash3(seed * 53.1) * (1.1 + seed * 1.3);
    float e = t * t * (3.0 - 2.0 * t);
    p = mix(mix(aStart, mid, e), mix(mid, aEnd, e), e);
    fade = sin(t * 3.14159) * 0.9 + 0.1;
  } else {
    // confetti: pop outward, then sink and flutter. aEnd is the pop displacement
    float k = 1.0 - exp(-t * 5.0);
    p = aStart + aEnd * k;
    float sec = t * aTime.y;
    p.y -= 0.9 * sec * sec;
    p.x += sin(sec * 7.0 + seed * 40.0) * 0.07 * t;
    p.z += cos(sec * 6.0 + seed * 23.0) * 0.07 * t;
    fade = 1.0 - smoothstep(0.72, 1.0, t);
    grow = 0.75 + 0.25 * sin(sec * 11.0 + seed * 50.0);   // glints as it tumbles
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = aColor.a * uScale / max(0.1, -mv.z) * (mode > 2.5 ? grow : 0.55 + fade * 0.6);
  vColor = vec4(aColor.rgb, mode > 2.5 ? fade : fade * 0.9);
  gl_Position = projectionMatrix * mv;
}`;

// Ambient bokeh: a few soft pastel discs drifting through the room.
export const dustVert = /* glsl */ `
attribute vec4 aSeed;     // xyz phase, w size
uniform float uTime;
uniform float uScale;
uniform float uEnergy;    // 0..1, rises with temperature
uniform vec3 uColor;
varying vec4 vColor;
void main() {
  vec3 p = position;
  float sp = 0.12 + uEnergy * 0.5;
  p.x += sin(uTime * sp * (0.6 + aSeed.x) + aSeed.y * 6.28) * 0.6;
  p.y += uTime * (0.05 + aSeed.z * 0.09) * (1.0 + uEnergy * 3.0);
  p.z += cos(uTime * sp * (0.5 + aSeed.z) + aSeed.x * 6.28) * 0.5;
  p.y = mod(p.y + 7.0, 14.0) - 7.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float size = aSeed.w * uScale / max(0.2, depth);
  // out-of-focus near / far particles grow and dim like bokeh
  float blur = 1.0 + smoothstep(7.0, 2.5, depth) * 5.0 + smoothstep(14.0, 30.0, depth) * 1.5;
  gl_PointSize = size * blur;
  float tw = 0.6 + 0.4 * sin(uTime * (0.6 + aSeed.y * 1.4) + aSeed.z * 40.0);
  float edgeFade = smoothstep(7.0, 5.5, abs(p.y));
  vec3 pastel = mix(vec3(1.0), 0.5 + 0.5 * cos(6.2831853 * (aSeed.x + vec3(0.0, 0.33, 0.67))), 0.6);
  vColor = vec4(pastel * uColor, tw * edgeFade * 0.2 / (blur * blur * 0.55 + 0.45));
  gl_Position = projectionMatrix * mv;
}`;

// ---------------------------------------------------------------- floor
// A plane of small dots far below: just enough ground for parallax to read.
export const gridVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const gridFrag = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPulse;     // seconds since the last shockwave
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz;
  vec2 g = fract(p) - 0.5;
  float d = length(g);
  float px = max(fwidth(p.x), fwidth(p.y));
  float dotA = 1.0 - smoothstep(0.055 - px, 0.055 + px, d);
  dotA *= smoothstep(0.45, 0.12, px);                      // dissolve before the dots alias
  float dist = length(vec2(p.x * 0.6, p.y + 2.0));
  float fade = exp(-dist * 0.06) * smoothstep(9.0, 4.0, vWorld.z);
  // a ripple runs across the floor whenever a molecule is completed
  float shock = exp(-pow((dist - uPulse * 26.0) * 0.4, 2.0)) * exp(-uPulse * 1.2) * 3.0;
  gl_FragColor = vec4(uColor, dotA * fade * (0.55 + shock) * uAlpha);
}`;
