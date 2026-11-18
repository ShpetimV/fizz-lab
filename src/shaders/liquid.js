// Liquid metal: a ray-marched surface made of up to 16 spheres melted together
// with a smooth minimum, dented by fingertips and, for ferrofluid, raised into
// spikes toward a magnet. Writes depth so the hand rig hides behind it.
import { BACKDROP, ENVIRONMENT } from './scene.js';

export const MAX_CELLS = 16;
export const MAX_POKES = 6;

export const liquidVert = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const liquidFrag = /* glsl */ `
precision highp float;
${BACKDROP}
${ENVIRONMENT}
#define MAX_CELLS ${MAX_CELLS}
#define MAX_POKES ${MAX_POKES}
uniform vec2 uRes;
uniform mat4 uInvVP;
uniform mat4 uVP;
uniform vec3 uEye;
uniform vec4 uCells[MAX_CELLS];
uniform int uCount;
uniform vec4 uPokes[MAX_POKES];
uniform int uPokeCount;
uniform vec4 uBound;      // xyz centre, w radius of a sphere enclosing everything
uniform vec4 uSpike;      // xyz centre of the droplet that grows spikes, w its radius
uniform vec4 uMagnet;     // xyz magnet position, w spike amount 0..1
uniform vec3 uTint;
uniform float uMetal;     // 1 metal, 0 glossy dielectric (ferrofluid's oil)
uniform float uRough;
uniform float uHeat;      // molten glow
uniform float uPixel;     // world size of one pixel at distance 1
uniform float uAlpha;
uniform float uSteps;

const float PI = 3.14159265;
const float PHI = 1.61803399;
const float SPIKES = 150.0;

float rnd(float x) { return floor(x + 0.5); }

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Nearest of n points spread evenly over the unit sphere (spherical Fibonacci,
// after Keinert et al.). Returns (index, chord distance). Ferrofluid spikes
// stand on these points, which gives their honeycomb-like packing.
vec2 inverseSF(vec3 p, float n) {
  float m = 1.0 - 1.0 / n;
  float phi = min(atan(p.y, p.x), PI);
  float cosTheta = p.z;
  float k = max(2.0, floor(log(n * PI * sqrt(5.0) * (1.0 - cosTheta * cosTheta)) / log(PHI * PHI)));
  float Fk = pow(PHI, k) / sqrt(5.0);
  vec2 F = vec2(rnd(Fk), rnd(Fk * PHI));
  vec2 ka = 2.0 * F / n;
  vec2 kb = 2.0 * PI * (fract((F + 1.0) * PHI) - (PHI - 1.0));
  mat2 iB = mat2(ka.y, -ka.x, kb.y, -kb.x) / (ka.y * kb.x - ka.x * kb.y);
  vec2 c = floor(iB * vec2(phi, cosTheta - m));
  float d = 8.0;
  float j = 0.0;
  for (int s = 0; s < 4; s++) {
    vec2 uv = vec2(mod(float(s), 2.0), floor(float(s) / 2.0));
    float i = dot(F, uv + c);
    float ph = 2.0 * PI * fract(i * PHI);
    float ct = m - i * 2.0 / n;
    float st = sqrt(max(0.0, 1.0 - ct * ct));
    vec3 q = vec3(cos(ph) * st, sin(ph) * st, ct);
    float sq = dot(q - p, q - p);
    if (sq < d) {
      d = sq;
      j = i;
    }
  }
  return vec2(j, sqrt(d));
}

float spikes(vec3 p) {
  vec3 q = p - uSpike.xyz;
  float rq = length(q);
  if (rq > uSpike.w * 1.9 || rq < 1e-3) return 0.0;
  vec3 n = q / rq;
  vec3 toM = uMagnet.xyz - uSpike.xyz;
  float face = smoothstep(0.0, 0.8, dot(n, normalize(toM)));
  if (face <= 0.0) return 0.0;
  float x = clamp(inverseSF(n, SPIKES).y / 0.15, 0.0, 1.0);
  float near = smoothstep(4.8, 1.4, length(toM));
  return pow(1.0 - x, 2.4) * face * near * uMagnet.w * uSpike.w * 0.6;
}

float map(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < MAX_CELLS; i++) {
    if (i >= uCount) break;
    vec4 c = uCells[i];
    d = smin(d, length(p - c.xyz) - c.w, 0.32);
  }
  // spikes are a steep displacement: march more carefully where they can be
  if (uMagnet.w > 0.002 && d < 0.75) d = (d - spikes(p)) * 0.42;
  // fingertips press dimples into the surface (smooth subtraction)
  for (int i = 0; i < MAX_POKES; i++) {
    if (i >= uPokeCount) break;
    vec4 f = uPokes[i];
    d = -smin(-d, length(p - f.xyz) - f.w, 0.16);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(1.0, -1.0) * 0.5773 * 0.0025;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 shade(vec3 p, vec3 rd) {
  vec3 N = calcNormal(p);
  vec3 V = -rd;
  vec3 R = reflect(rd, N);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 env = room(R);
  if (uRough > 0.01) {
    // a satin finish: average a few nearby reflection directions
    vec3 t1 = normalize(cross(R, vec3(0.0, 1.0, 0.13)));
    vec3 t2 = cross(R, t1);
    env = (env + room(normalize(R + t1 * uRough)) + room(normalize(R - t1 * uRough)) + room(normalize(R + t2 * uRough))
      + room(normalize(R - t2 * uRough))) * 0.2;
  }
  float fres = pow(1.0 - ndv, 5.0);
  vec3 metal = env * (uTint + (1.0 - uTint) * fres);
  vec3 L = normalize(vec3(-0.4, 0.75, 0.55));
  // glossy oil over black: the room shows only faintly head-on, strongly toward the edges
  vec3 diel = uTint * (0.25 + 0.75 * max(dot(N, L), 0.0)) + env * (0.09 + 0.91 * fres) * 1.5
    + vec3(1.0) * pow(max(dot(R, L), 0.0), 160.0) * 3.0 + vec3(0.75, 0.8, 0.9) * pow(1.0 - ndv, 2.5) * 0.12;
  vec3 col = mix(diel, metal, uMetal);
  // creases between droplets and around fingertips get a little darker
  float ao = clamp(0.3 + 0.7 * map(p + N * 0.22) / 0.22, 0.0, 1.0);
  col *= mix(0.5, 1.0, ao);
  if (uHeat > 0.001) {
    // molten: the metal glows on its own; slow convection cells drift over it
    float n = vnoise(p * 2.4 + vec3(0.0, uTime * 0.4, uTime * 0.25)) * 0.65 + vnoise(p * 6.0 - uTime * 0.3) * 0.35;
    float crust = smoothstep(0.55, 0.8, vnoise(p * 3.5 + vec3(uTime * 0.15, 0.0, 0.0)));
    vec3 glow = mix(vec3(0.95, 0.32, 0.04), vec3(1.0, 0.72, 0.3), n) * (0.55 + 0.5 * n) * (1.0 - crust * 0.55);
    // the glow is strongest where you look straight into the hot metal; the edges keep their mirror sheen
    col = mix(col, col * 0.65 + glow * (0.4 + 0.65 * ndv), uHeat);
  }
  return col;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0);
  vec3 ro = uEye;
  vec3 rd = normalize(a.xyz / a.w - ro);
  // only march inside the sphere that encloses the liquid
  vec3 oc = ro - uBound.xyz;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + uBound.w * uBound.w;
  if (h < 0.0) discard;
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float tEnd = -b + h;
  float best = 1e5;
  float tBest = t;
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= uSteps || t > tEnd) break;
    float d = map(ro + rd * t);
    float cover = d / (uPixel * t); // distance to the surface in pixels
    if (cover < best) {
      best = cover;
      tBest = t;
    }
    if (d < 0.0004 * t) {
      hit = true;
      tBest = t;
      break;
    }
    t += d;
  }
  // a ray that just grazes the surface still covers part of the pixel: soft, anti-aliased silhouette
  float alpha = hit ? 1.0 : 1.0 - smoothstep(0.0, 1.0, best);
  if (alpha < 0.01) discard;
  vec3 p = ro + rd * tBest;
  vec3 col = shade(p, rd);
  vec4 clip = uVP * vec4(p, 1.0);
  gl_FragDepthEXT = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha * uAlpha);
}`;
