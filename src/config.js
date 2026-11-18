// Shared constants. World units: the "window" (webcam plane) sits at z = 0 and is
// 2 * VIEW.halfH tall; +z comes toward the viewer.
export const VIEW = {
  halfH: 4,
  dist: 9, // eye distance from the window plane
  near: 0.2,
  far: 140,
};

export const QUALITY = {
  high: {
    name: 'HIGH',
    pixelRatio: 1.5,
    bloomStrength: 0.22,
    bloomRadius: 0.35,
    bloomThreshold: 0.82,
    msaa: 4,
    post: 1, // frosted-glass blur taps, bokeh
    dust: 260,
    particleScale: 1,
    trail: 5, // electron trail samples
  },
  low: {
    name: 'LOW',
    pixelRatio: 1,
    bloomStrength: 0.22,
    bloomRadius: 0.3,
    bloomThreshold: 0.85,
    msaa: 0,
    post: 0,
    dust: 90,
    particleScale: 0.4,
    trail: 2,
  },
};

// Palette: neutral white for structure, system-style colours for meaning.
export const COL = {
  accent: [0.96, 0.97, 1.0], // guides, rings, hand rig
  white: [1, 1, 1],
  electron: [1.0, 0.86, 0.34],
  ok: [0.19, 0.84, 0.42], // "these will bond"
  red: [1.0, 0.27, 0.23],
  gold: [1.0, 0.8, 0.2],
  blue: [0.2, 0.56, 1.0],
  water: [0.39, 0.82, 1.0],
  ice: [0.8, 0.92, 1.0],
  hot: [1.0, 0.62, 0.1],
};

// Celebration colours (confetti, collection chips).
export const PARTY = [
  [1.0, 0.22, 0.37],
  [1.0, 0.62, 0.04],
  [1.0, 0.84, 0.04],
  [0.19, 0.82, 0.35],
  [0.39, 0.82, 1.0],
  [0.04, 0.52, 1.0],
  [0.75, 0.35, 0.95],
];

export const TEMP = { min: -60, max: 160, start: 25 };

// Depth range (world z) that hands / held objects may occupy.
export const DEPTH = { min: -3.2, max: 3.6 };
