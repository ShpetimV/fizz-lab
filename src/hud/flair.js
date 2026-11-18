import { PARTY } from '../config.js';

// One emoji per molecule, each pointing at something true about it.
export const EMOJI = {
  H2: '🚀', // rocket fuel
  O2: '🫁', // what we breathe
  N2: '🌬️', // most of the air
  Cl2: '🟢', // yellow-green gas
  HCl: '🧪', // hydrochloric acid when dissolved
  H2O: '💧',
  H2O2: '🫧', // bubbles as it decomposes
  CO2: '🥤', // the fizz in drinks
  CO: '⚠️', // toxic
  CH4: '🔥', // natural gas
  NH3: '🌱', // fertiliser
  HCN: '☠️', // very toxic
  C2H6: '⛽', // part of natural gas
  C2H4: '🍌', // ripens fruit
  C2H2: '🛠️', // welding torches
  CH3OH: '🏎️', // racing fuel
  NaCl: '🧂',
  NaOH: '🧼', // soap making
  CH2O: '🧫', // preserves specimens
  CH3Cl: '❄️', // once a refrigerant
  CCl4: '🧯', // once used in fire extinguishers
  HOCl: '🏊', // what disinfects pool water
  C2H5OH: '🍷',
  CH3OCH3: '💨', // aerosol propellant
  CH3NH2: '🐟', // fishy smell
  C3H8: '🍖', // barbecue gas
  NaH: '⚗️',
  NaOCl: '🧴', // bleach
};

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

/** A party colour for the n-th thing (collection chips, formula pills). */
export const flairColor = (n) => css(PARTY[((n % PARTY.length) + PARTY.length) % PARTY.length]);

/** Text colour that reads on that party colour (dark on the yellow, white elsewhere). */
export const flairInk = (n) => {
  const [r, g, b] = PARTY[((n % PARTY.length) + PARTY.length) % PARTY.length];
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.7 ? '#1c1c1e' : '#fff';
};

const RANKS = [
  [18, 'Molecule master'],
  [13, 'Bond wizard'],
  [8, 'Chemist'],
  [4, 'Lab regular'],
  [1, 'Apprentice'],
  [0, 'Newcomer'],
];

export const rankFor = (count) => RANKS.find(([min]) => count >= min)[1];
