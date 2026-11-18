// Thin-film interference of a soap film. Pure module, shared by the shader
// (as constants), the HUD chart and the tests.
//
// Light reflects off the front and the back of the film. The back reflection
// travels an extra 2·n·d·cos(θt) and the front one is flipped by half a wave,
// so the reflected intensity of wavelength λ goes as sin²(2π·n·d·cos(θt) / λ):
// zero for a film much thinner than the light (the "black film" seen just
// before a bubble bursts), and coloured bands as the film thickens.

export const FILM_INDEX = 1.33; // soapy water

// A coarse spectrum: wavelength (nm) and how much it adds to R, G and B. Each
// channel is normalised so a film that reflected every wavelength fully would
// come out white.
const RAW = [
  [400, 0.15, 0.0, 0.45],
  [430, 0.1, 0.0, 0.95],
  [460, 0.0, 0.15, 1.0],
  [490, 0.0, 0.55, 0.6],
  [520, 0.05, 0.95, 0.15],
  [550, 0.45, 1.0, 0.0],
  [580, 0.95, 0.75, 0.0],
  [610, 1.0, 0.35, 0.0],
  [640, 0.85, 0.08, 0.0],
  [670, 0.45, 0.0, 0.0],
  [700, 0.15, 0.0, 0.0],
];
const SUM = [1, 2, 3].map((k) => RAW.reduce((s, row) => s + row[k], 0));
export const SPECTRUM = RAW.map(([nm, r, g, b]) => [nm, r / SUM[0], g / SUM[1], b / SUM[2]]);

/**
 * Relative reflected colour of a film `nm` thick, seen at incidence cos θ = cosI.
 * Returns [r, g, b] in 0..1 (multiply by the film's overall reflectance).
 */
export function filmColor(nm, cosI = 1, n = FILM_INDEX) {
  const sin2 = Math.max(0, 1 - cosI * cosI);
  const cosT = Math.sqrt(Math.max(0, 1 - sin2 / (n * n)));
  const out = [0, 0, 0];
  for (const [lambda, r, g, b] of SPECTRUM) {
    const s = Math.sin((2 * Math.PI * n * nm * cosT) / lambda);
    const i = s * s;
    out[0] += r * i;
    out[1] += g * i;
    out[2] += b * i;
  }
  return out;
}

/** GLSL constant table of the spectrum (vec4: wavelength, r, g, b). */
export const SPECTRUM_GLSL = `const int SPECTRUM_N = ${SPECTRUM.length};
vec4 spectrum(int i) {
${SPECTRUM.map(([nm, r, g, b], i) => `  if (i == ${i}) return vec4(${nm.toFixed(1)}, ${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)});`).join('\n')}
  return vec4(0.0);
}`;
