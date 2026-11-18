// Soap bubbles: instanced spheres, additive (a bubble only adds reflected light
// to what is behind it), both walls drawn. Colour is thin-film interference
// computed per pixel from the local film thickness.
import { BACKDROP, ENVIRONMENT } from './scene.js';
import { SPECTRUM_GLSL, FILM_INDEX } from '../bubbles/film.js';

export const bubbleVert = /* glsl */ `
attribute vec4 iPosR;     // xyz, radius
attribute vec4 iFilm;     // x film thickness at the top (nm), y seed, z wobble, w alpha
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vView;
varying vec4 vFilm;
uniform float uTime;
void main() {
  // the film shivers a little: a few slow surface waves
  float w = iFilm.z * (sin(position.x * 5.0 + uTime * 3.1 + iFilm.y) * sin(position.y * 4.0 + uTime * 2.3) * 0.03);
  vec3 local = position * (1.0 + w);
  vec4 mv = viewMatrix * vec4(iPosR.xyz + local * iPosR.w, 1.0);
  vN = mat3(viewMatrix) * normal;
  vObjN = normal;
  vView = -mv.xyz;
  vFilm = iFilm;
  gl_Position = projectionMatrix * mv;
}`;

export const bubbleFrag = /* glsl */ `
precision highp float;
${BACKDROP}
${ENVIRONMENT}
${SPECTRUM_GLSL}
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vView;
varying vec4 vFilm;
const float FILM_N = ${FILM_INDEX.toFixed(2)};

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 film(float nm, float cosI) {
  float cosT = sqrt(max(0.0, 1.0 - (1.0 - cosI * cosI) / (FILM_N * FILM_N)));
  vec3 c = vec3(0.0);
  for (int i = 0; i < SPECTRUM_N; i++) {
    vec4 s = spectrum(i);
    float x = sin(6.2831853 * FILM_N * nm * cosT / s.x);
    c += s.yzw * x * x;
  }
  return c;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  if (!gl_FrontFacing) N = -N; // the far wall, seen from inside
  float cosI = clamp(abs(dot(N, V)), 0.0, 1.0);
  // drainage: the film is thinnest at the top; swirls of thicker and thinner film drift over it
  vec3 o = vObjN;
  float swirl = vnoise(o * 2.2 + vec3(vFilm.y, uTime * 0.12, uTime * 0.07)) - 0.5;
  float nm = vFilm.x * (0.55 + 0.45 * (1.0 - o.y)) * (1.0 + swirl * 0.35);
  vec3 tint = film(nm, cosI);
  // a soap film reflects only a few percent head-on, much more at grazing angles
  float fres = 0.06 + 0.94 * pow(1.0 - cosI, 3.0);
  vec3 R = reflect(-V, N);
  // the film reflects the room plus the general brightness of the space around it
  vec3 col = (room(R) + vec3(0.32, 0.33, 0.36)) * tint * fres * 2.6;
  // the bright window glints stay on even as the film thins (they come off the front surface)
  col += studio(R) * 0.08 * (0.3 + 0.7 * fres);
  gl_FragColor = vec4(col * vFilm.w * (gl_FrontFacing ? 1.0 : 0.55), 1.0);
}`;
