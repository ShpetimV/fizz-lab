// Element data. Pure module: no DOM, no Three.js.
//
// valence          – number of bonds the neutral atom forms in this model
// valenceElectrons – outer-shell electrons (shown orbiting, simplified Bohr-style)
// covalentRadius   – single-bond covalent radius in picometres (Cordero et al. 2008)
// cpk              – CPK colour convention (H white, C grey, N blue, O red, Na violet, Cl green)
// ink              – colour of the symbol printed on the atom (dark on light atoms)
// display          – sphere radius in scene units
export const ELEMENTS = {
  H: { symbol: 'H', name: 'Hydrogen', Z: 1, valence: 1, valenceElectrons: 1, covalentRadius: 31, metal: false, cpk: [0.95, 0.95, 0.97], ink: [0.16, 0.16, 0.2], display: 0.27 },
  C: { symbol: 'C', name: 'Carbon', Z: 6, valence: 4, valenceElectrons: 4, covalentRadius: 76, metal: false, cpk: [0.3, 0.31, 0.35], ink: [1, 1, 1], display: 0.4 },
  N: { symbol: 'N', name: 'Nitrogen', Z: 7, valence: 3, valenceElectrons: 5, covalentRadius: 71, metal: false, cpk: [0.1, 0.48, 1.0], ink: [1, 1, 1], display: 0.38 },
  O: { symbol: 'O', name: 'Oxygen', Z: 8, valence: 2, valenceElectrons: 6, covalentRadius: 66, metal: false, cpk: [1.0, 0.25, 0.22], ink: [1, 1, 1], display: 0.37 },
  Na: { symbol: 'Na', name: 'Sodium', Z: 11, valence: 1, valenceElectrons: 1, covalentRadius: 166, metal: true, cpk: [0.72, 0.36, 0.95], ink: [1, 1, 1], display: 0.5 },
  Cl: { symbol: 'Cl', name: 'Chlorine', Z: 17, valence: 1, valenceElectrons: 7, covalentRadius: 102, metal: false, cpk: [0.2, 0.82, 0.36], ink: [1, 1, 1], display: 0.46 },
};

export const ELEMENT_ORDER = ['H', 'C', 'N', 'O', 'Na', 'Cl'];

export function isElement(symbol) {
  return Object.prototype.hasOwnProperty.call(ELEMENTS, symbol);
}
