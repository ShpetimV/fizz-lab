// Final full-screen pass: shock ripple, phase tint, highlight roll-off, a light
// vignette, a soft lift of white on impacts and a red edge blush on refusals.
export const FinalShader = {
  name: 'LabFinalShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uVignette: { value: 0.22 },
    uTint: { value: [1, 1, 1] },
    uFlash: { value: 0 },
    uShock: { value: [0.5, 0.5, 0, 0] }, // centre xy (uv), radius, strength
    uGlitch: { value: 0 }, // 0..1 "that was refused"
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uVignette;
    uniform vec3 uTint;
    uniform float uFlash;
    uniform vec4 uShock;
    uniform float uGlitch;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      // shockwave: a thin refracting ring travelling outward from the molecule
      float ringGlow = 0.0;
      if (uShock.w > 0.001) {
        vec2 d = uv - uShock.xy;
        d.x *= uAspect;
        float r = length(d);
        float ring = exp(-pow((r - uShock.z) * 16.0, 2.0)) * uShock.w;
        uv -= normalize(d + 1e-5) * ring * 0.018;
        ringGlow = ring;
      }

      vec2 c = uv - 0.5;
      vec3 col = texture2D(tDiffuse, uv).rgb;

      col *= uTint;
      col += vec3(1.0) * ringGlow * 0.04;
      col += vec3(1.0) * uFlash * 0.06;
      // refusal: the edges of the frame blush red for a moment
      float edge = smoothstep(0.25, 0.75, length(c * vec2(1.0, 1.15)));
      col = mix(col, col * vec3(1.0, 0.62, 0.6) + vec3(0.1, 0.0, 0.0), uGlitch * edge * 0.8);

      // roll off only the brightest highlights; mid-tones stay exactly as authored
      col = col / (1.0 + max(col - 0.8, 0.0) * 0.6);

      float v = smoothstep(1.05, 0.25, length(c * vec2(1.0, 1.12)) * 1.25);
      col *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};
