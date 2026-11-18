// Public surface of the chemistry core. Everything exported here is pure
// logic with no DOM or Three.js dependency, so it runs unchanged under Vitest.
export { ELEMENTS, ELEMENT_ORDER, isElement } from './elements.js';
export { ChemGraph, formula, composition, rejectionText, subscript } from './chem.js';
export { CATALOG, CORE_COUNT, NOTE, identify, signature, buildEntry } from './catalog.js';
export { layoutMolecule, describeCentre, bondLength, TETRAHEDRAL } from './geometry.js';
