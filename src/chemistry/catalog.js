// Catalogue of recognisable molecules. Pure module: no DOM, no Three.js.
//
// Each entry lists its atoms and bonds ([i, j, order, type?]). Bonds are listed
// in an order in which the molecule can actually be assembled under the lab's
// bonding rules (the unit tests build every entry that way).
//
// angles    – measured bond angle (degrees) at centres of that element, where it
//             differs from the generic VSEPR estimate
// dihedral  – torsion angle (degrees) for the central bond, where relevant
// approx    – the displayed angle is the ideal VSEPR value, slightly off the measured one
// recipe    – a build order that works under the lab's bonding rules (shown as a hint)
import { ChemGraph, formula } from './chem.js';

const BOHR_NOTE = 'Electrons are drawn Bohr-style for clarity. Real electrons form clouds, not orbits.';

export const CATALOG = [
  {
    id: 'H2', recipe: 'H + H', name: 'Hydrogen', formula: 'H₂', atoms: ['H', 'H'], bonds: [[0, 1, 1]],
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'Each hydrogen shares its single electron, so both feel a full shell of two. Two atoms can only ever lie on a straight line. H₂ is the lightest of all molecules.',
    say: 'Hydrogen gas. One shared pair, two contented atoms. The lightest molecule there is.',
  },
  {
    id: 'O2', recipe: 'O + O', name: 'Oxygen', formula: 'O₂', atoms: ['O', 'O'], bonds: [[0, 1, 2]],
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'Each oxygen needs two more electrons, so the pair shares two electron pairs: a double bond. O₂ makes up about 21% of the air you are breathing.',
    say: 'Molecular oxygen, double bonded. Roughly a fifth of the air in this room.',
  },
  {
    id: 'N2', recipe: 'N + N', name: 'Nitrogen', formula: 'N₂', atoms: ['N', 'N'], bonds: [[0, 1, 3]],
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'Each nitrogen needs three electrons, so they share three pairs. This triple bond (945 kJ/mol) is among the strongest known, which is why N₂ — 78% of air — is so unreactive.',
    say: 'Nitrogen. A triple bond, and among the strongest in chemistry. It makes up most of the air and does very little about it.',
  },
  {
    id: 'Cl2', recipe: 'Cl + Cl', name: 'Chlorine', formula: 'Cl₂', atoms: ['Cl', 'Cl'], bonds: [[0, 1, 1]],
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'Each chlorine has seven valence electrons and shares one to complete its octet. Cl₂ is a yellow-green toxic gas, used in small doses to disinfect drinking water.',
    say: 'Chlorine gas. Yellow-green, toxic, and best admired as a hologram.',
  },
  {
    id: 'HCl', recipe: 'H + Cl', name: 'Hydrogen chloride', formula: 'HCl', atoms: ['H', 'Cl'], bonds: [[0, 1, 1]],
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'Chlorine is far more electronegative than hydrogen and pulls the shared pair toward itself, so the bond is polar. Dissolved in water it is hydrochloric acid — the acid in your stomach.',
    say: 'Hydrogen chloride. Dissolve it in water and you have the acid in your own stomach.',
  },
  {
    id: 'H2O', recipe: 'O + H + H', name: 'Water', formula: 'H₂O', atoms: ['O', 'H', 'H'], bonds: [[0, 1, 1], [0, 2, 1]],
    shape: 'Bent', angle: '104.5°',
    fact: 'Oxygen has four electron pairs: two bonds and two lone pairs. Lone pairs repel more strongly than bonding pairs, squeezing the H–O–H angle from the tetrahedral 109.5° down to 104.5°.',
    say: 'Water. Bent at one hundred and four point five degrees. Two lone pairs on the oxygen are doing the pushing.',
  },
  {
    id: 'H2O2', recipe: 'make two O–H pairs, then join the two O', name: 'Hydrogen peroxide', formula: 'H₂O₂', atoms: ['O', 'O', 'H', 'H'], bonds: [[0, 2, 1], [1, 3, 1], [0, 1, 1]],
    shape: 'Non-planar “open book”', angle: 'H–O–O 94.8° · twist 111.5°',
    angles: { O: 94.8 }, dihedral: 111.5,
    fact: 'The lone pairs on the two neighbouring oxygens repel each other, twisting the molecule like a half-open book. Its weak O–O bond breaks easily, which is what makes it a bleach and disinfectant.',
    say: 'Hydrogen peroxide. Twisted like a half-open book, with a rather fragile oxygen to oxygen bond.',
  },
  {
    id: 'CO2', recipe: 'C + O + O', name: 'Carbon dioxide', formula: 'CO₂', atoms: ['C', 'O', 'O'], bonds: [[0, 1, 2], [0, 2, 2]],
    shape: 'Linear', angle: '180°',
    fact: 'Carbon forms two double bonds and keeps no lone pairs. Two groups of electrons get as far apart as possible — exactly opposite — so the molecule is a straight line.',
    say: 'Carbon dioxide. Two double bonds, no lone pairs on the carbon, perfectly linear. You are exhaling it as we speak.',
  },
  {
    id: 'CO', recipe: 'C + O, then let go and wait', name: 'Carbon monoxide', formula: 'CO', atoms: ['C', 'O'], bonds: [[0, 1, 3]], dative: true,
    shape: 'Linear (diatomic)', angle: '— (two atoms)',
    fact: 'A triple bond in which oxygen donates one of its own lone pairs (a dative bond). Colourless, odourless and toxic: it binds to haemoglobin over 200 times more strongly than oxygen does.',
    say: 'Carbon monoxide. Oxygen has lent a lone pair to complete a triple bond. Odourless, and decidedly unfriendly to haemoglobin.',
  },
  {
    id: 'CH4', recipe: 'C + 4 × H', name: 'Methane', formula: 'CH₄', atoms: ['C', 'H', 'H', 'H', 'H'], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
    shape: 'Tetrahedral', angle: '109.5°',
    fact: 'Four bonding pairs and no lone pairs: the four C–H bonds spread out evenly in three dimensions, pointing to the corners of a tetrahedron. Methane is the main component of natural gas.',
    say: 'Methane. A perfect tetrahedron, one hundred and nine point five degrees all round.',
  },
  {
    id: 'NH3', recipe: 'N + 3 × H', name: 'Ammonia', formula: 'NH₃', atoms: ['N', 'H', 'H', 'H'], bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
    shape: 'Trigonal pyramidal', angle: '107°',
    fact: 'Nitrogen has three bonds plus one lone pair. The lone pair takes the fourth tetrahedral position and pushes the three N–H bonds together, to about 107°.',
    say: 'Ammonia. Trigonal pyramidal. The lone pair on top presses the hydrogens down to about one hundred and seven degrees.',
  },
  {
    id: 'HCN', recipe: 'C + N first, then add H', name: 'Hydrogen cyanide', formula: 'HCN', atoms: ['C', 'N', 'H'], bonds: [[0, 1, 3], [0, 2, 1]],
    shape: 'Linear', angle: '180°',
    fact: 'Carbon holds one single bond and one triple bond — just two groups of electrons — so they point in opposite directions. Extremely toxic.',
    say: 'Hydrogen cyanide. Linear, triple bonded, and extremely toxic. I would not recommend a physical sample.',
  },
  {
    id: 'C2H6', recipe: 'make two CH₃ (C + 3 H), then join the two C', name: 'Ethane', formula: 'C₂H₆', atoms: ['C', 'C', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [[0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [1, 7, 1], [0, 1, 1]],
    shape: 'Two tetrahedral carbons', angle: '≈109.5°', approx: true,
    fact: 'Each carbon makes four single bonds, so each one is tetrahedral. The two CH₃ groups can spin around the C–C single bond and prefer the staggered arrangement shown.',
    say: 'Ethane. Two tetrahedral carbons joined by a single bond, around which they rotate quite freely.',
  },
  {
    id: 'C2H4', recipe: 'make two CH₂ (C + 2 H), then join the two C', name: 'Ethene (ethylene)', formula: 'C₂H₄', atoms: ['C', 'C', 'H', 'H', 'H', 'H'],
    bonds: [[0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1], [0, 1, 2]],
    shape: 'Trigonal planar at each carbon', angle: '≈120°', approx: true,
    fact: 'Each carbon has three groups of electrons, arranged flat at about 120°. The double bond cannot twist, locking all six atoms in one plane. Ethene is the plant hormone that ripens fruit.',
    say: 'Ethene. The double bond locks all six atoms into one plane. It is also what ripens your bananas.',
  },
  {
    id: 'C2H2', recipe: 'C + C first, then one H on each', name: 'Ethyne (acetylene)', formula: 'C₂H₂', atoms: ['C', 'C', 'H', 'H'],
    bonds: [[0, 1, 3], [0, 2, 1], [1, 3, 1]],
    shape: 'Linear', angle: '180°',
    fact: 'A triple bond leaves each carbon with only two groups of electrons, so all four atoms sit on one line. Burned with pure oxygen it gives a flame above 3000 °C, hot enough to weld steel.',
    say: 'Ethyne, also called acetylene. A triple bond, four atoms in a line. Welders are rather fond of it.',
  },
  {
    id: 'CH3OH', recipe: 'make CH₃ and O–H, then join C to O', name: 'Methanol', formula: 'CH₃OH', atoms: ['C', 'O', 'H', 'H', 'H', 'H'],
    bonds: [[0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [0, 1, 1]],
    shape: 'Tetrahedral C · bent O', angle: '109.5° at C · 108.5° at O', angles: { O: 108.5 }, approx: true,
    fact: 'Tetrahedral around carbon, bent at oxygen (two lone pairs) — like methane and water sharing a bond. Methanol is the simplest alcohol, and poisonous to drink.',
    say: 'Methanol. The simplest alcohol. Tetrahedral at the carbon, bent at the oxygen, and not for drinking.',
  },
  {
    id: 'NaCl', recipe: 'Na + Cl', name: 'Sodium chloride', formula: 'NaCl', atoms: ['Na', 'Cl'], bonds: [[0, 1, 1, 'ionic']],
    shape: 'Ionic — no fixed molecular shape', angle: '— (ionic)',
    fact: 'No electrons are shared here: sodium gives its single valence electron to chlorine. The resulting Na⁺ and Cl⁻ ions attract each other electrostatically. Packed into a crystal, this is table salt.',
    say: 'Sodium chloride. No sharing this time: sodium simply hands over its electron, and the two ions cling together. Table salt.',
  },
  {
    id: 'NaOH', recipe: 'make O–H, then add Na', name: 'Sodium hydroxide', formula: 'NaOH', atoms: ['Na', 'O', 'H'], bonds: [[1, 2, 1], [0, 1, 1, 'ionic']],
    shape: 'Ionic: Na⁺ + OH⁻', angle: '— (ionic)',
    fact: 'Sodium transfers its valence electron to the O–H group, forming Na⁺ and the hydroxide ion OH⁻ (O–H is still covalent). A strong base, known as lye or caustic soda and used to make soap.',
    say: 'Sodium hydroxide. A sodium ion and a hydroxide ion. A strong base, so do mind your holographic fingers.',
  },

  // ---- bonus structures: recognised and named, but not part of the 18 ----
  {
    id: 'CH2O', bonus: true, name: 'Formaldehyde', formula: 'CH₂O', atoms: ['C', 'O', 'H', 'H'],
    bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]],
    shape: 'Trigonal planar', angle: '≈120°', approx: true,
    fact: 'Carbon has three groups of electrons (two C–H bonds and one C=O double bond), so the molecule is flat with angles near 120°. It is the simplest aldehyde.',
    say: 'Formaldehyde. Flat, trigonal planar, and the simplest aldehyde. A bonus find.',
  },
  {
    id: 'CH3Cl', bonus: true, name: 'Chloromethane', formula: 'CH₃Cl', atoms: ['C', 'Cl', 'H', 'H', 'H'],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
    shape: 'Tetrahedral', angle: '≈109.5°', approx: true,
    fact: 'Methane with one hydrogen swapped for chlorine. Still four bonding pairs around carbon, so still tetrahedral — but the C–Cl bond makes the molecule polar.',
    say: 'Chloromethane. Methane with one hydrogen traded for chlorine. Still tetrahedral.',
  },
  {
    id: 'CCl4', bonus: true, name: 'Carbon tetrachloride', formula: 'CCl₄', atoms: ['C', 'Cl', 'Cl', 'Cl', 'Cl'],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
    shape: 'Tetrahedral', angle: '109.5°',
    fact: 'Four identical C–Cl bonds point to the corners of a perfect tetrahedron. Each bond is polar, but they cancel exactly, so the molecule as a whole is non-polar.',
    say: 'Carbon tetrachloride. Four polar bonds that cancel one another perfectly. Symmetry has its uses.',
  },
  {
    id: 'HOCl', bonus: true, name: 'Hypochlorous acid', formula: 'HOCl', atoms: ['O', 'H', 'Cl'], bonds: [[0, 1, 1], [0, 2, 1]],
    shape: 'Bent', angle: '≈103°', angles: { O: 102.5 }, approx: true,
    fact: 'Bent like water, because oxygen again carries two lone pairs. This is the active disinfectant that forms when chlorine dissolves in water.',
    say: 'Hypochlorous acid. Bent, like water. It is what actually does the disinfecting in a swimming pool.',
  },
  {
    id: 'C2H5OH', bonus: true, name: 'Ethanol', formula: 'C₂H₅OH', atoms: ['C', 'C', 'O', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [[0, 3, 1], [0, 4, 1], [0, 5, 1], [1, 6, 1], [1, 7, 1], [2, 8, 1], [0, 1, 1], [1, 2, 1]],
    shape: 'Tetrahedral C · bent O', angle: '≈109.5° at C', approx: true,
    fact: 'Two tetrahedral carbons and a bent oxygen. Ethanol is the alcohol in drinks. Dimethyl ether has exactly the same atoms, C₂H₆O, connected differently — the two are isomers.',
    say: 'Ethanol. The alcohol found in drinks. Same atoms as dimethyl ether, differently connected. Connectivity matters.',
  },
  {
    id: 'CH3OCH3', bonus: true, name: 'Dimethyl ether', formula: 'CH₃OCH₃', atoms: ['O', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [[1, 3, 1], [1, 4, 1], [1, 5, 1], [2, 6, 1], [2, 7, 1], [2, 8, 1], [0, 1, 1], [0, 2, 1]],
    shape: 'Bent at O · tetrahedral C', angle: 'C–O–C 111.7°', angles: { O: 111.7 }, approx: true,
    fact: 'Oxygen sits in the middle, bent by its two lone pairs. It has the same formula as ethanol, C₂H₆O, but a different structure — an isomer — and is a gas at room temperature.',
    say: 'Dimethyl ether. Same formula as ethanol, entirely different molecule. An isomer.',
  },
  {
    id: 'CH3NH2', bonus: true, name: 'Methylamine', formula: 'CH₃NH₂', atoms: ['C', 'N', 'H', 'H', 'H', 'H', 'H'],
    bonds: [[0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [0, 1, 1]],
    shape: 'Tetrahedral C · pyramidal N', angle: '≈109.5° at C · ≈107° at N', approx: true,
    fact: 'Tetrahedral at carbon and pyramidal at nitrogen, whose lone pair occupies the fourth position. The simplest amine — it smells of fish.',
    say: 'Methylamine. The simplest amine. I am told it smells of fish; I shall take your word for it.',
  },
  {
    id: 'C3H8', bonus: true, name: 'Propane', formula: 'C₃H₈', atoms: ['C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [[0, 3, 1], [0, 4, 1], [0, 5, 1], [2, 6, 1], [2, 7, 1], [2, 8, 1], [1, 9, 1], [1, 10, 1], [0, 1, 1], [1, 2, 1]],
    shape: 'Three tetrahedral carbons', angle: '≈109.5°', approx: true,
    fact: 'Three tetrahedral carbons in a row, so the carbon chain is a zig-zag, not a straight line. Propane is the fuel in gas barbecues.',
    say: 'Propane. Three carbons in a zig-zag. Eleven atoms assembled by hand; most impressive.',
  },
  {
    id: 'NaH', bonus: true, name: 'Sodium hydride', formula: 'NaH', atoms: ['Na', 'H'], bonds: [[0, 1, 1, 'ionic']],
    shape: 'Ionic — no fixed molecular shape', angle: '— (ionic)',
    fact: 'Here hydrogen takes an electron instead of sharing one, becoming the hydride ion H⁻ with a full shell of two. Sodium hydride reacts violently with water.',
    say: 'Sodium hydride. Hydrogen as a negative ion, for a change. Keep it well away from water.',
  },
  {
    id: 'NaOCl', bonus: true, name: 'Sodium hypochlorite', formula: 'NaOCl', atoms: ['Na', 'O', 'Cl'], bonds: [[1, 2, 1], [0, 1, 1, 'ionic']],
    shape: 'Ionic: Na⁺ + OCl⁻', angle: '— (ionic)',
    fact: 'A sodium ion paired with the hypochlorite ion OCl⁻, in which oxygen and chlorine share a covalent bond. Dissolved in water, this is household bleach.',
    say: 'Sodium hypochlorite. Household bleach, in other words.',
  },
];

export const NOTE = BOHR_NOTE;
export const CORE_COUNT = CATALOG.filter((e) => !e.bonus).length;

// ---------------------------------------------------------------- recognition
const bondSymbol = (bond) => (bond.type === 'ionic' ? '~' : ['', '-', '=', '#'][bond.order]);

/**
 * Canonical string for a fragment's connectivity (elements + bond orders +
 * bond types). Fragments here are always trees, so the canonical form is the
 * smallest rooted-tree encoding over all choices of root.
 */
export function signature(graph, ids) {
  const encode = (id, parent) => {
    const parts = [];
    for (const n of graph.neighbors(id)) {
      if (n.id === parent) continue;
      parts.push(bondSymbol(n.bond) + encode(n.id, id));
    }
    parts.sort();
    return `${graph.atom(id).el}(${parts.join('')})`;
  };
  let best = null;
  for (const id of ids) {
    const s = encode(id, -1);
    if (best === null || s < best) best = s;
  }
  return best;
}

/** Build a catalogue entry as a stand-alone graph. */
/** Bond existing atoms (ids in the order of entry.atoms) into the catalogue structure. Returns the bonds. */
export function linkEntry(graph, ids, entry) {
  const bonds = [];
  for (const [i, j, order, type] of entry.bonds) {
    const bond = graph._link(ids[i], ids[j], order, type || 'covalent');
    if (entry.dative) {
      bond.dative = true;
      const c = ids.find((id) => graph.atom(id).el === 'C');
      const o = ids.find((id) => graph.atom(id).el === 'O');
      graph.atom(c).charge = -1;
      graph.atom(o).charge = 1;
      bond.donor = o;
    }
    bonds.push(bond);
  }
  return bonds;
}

export function buildEntry(entry) {
  const graph = new ChemGraph();
  const ids = entry.atoms.map((el) => graph.addAtom(el).id);
  linkEntry(graph, ids, entry);
  return { graph, ids };
}

const BY_SIGNATURE = new Map();
for (const entry of CATALOG) {
  const { graph, ids } = buildEntry(entry);
  entry.signature = signature(graph, ids);
  if (BY_SIGNATURE.has(entry.signature)) throw new Error(`Duplicate catalogue structure: ${entry.id}`);
  BY_SIGNATURE.set(entry.signature, entry);
}

/**
 * Identify a fragment.
 * @returns {{complete: boolean, entry: object|null, formula: string, name: string}}
 * Complete fragments that are not in the catalogue are valid by the valence
 * rules and reported as an "unnamed structure" with their formula.
 */
export function identify(graph, ids) {
  const complete = graph.isComplete(ids);
  const f = formula(graph, ids);
  if (!complete) return { complete, entry: null, formula: f, name: null };
  const entry = BY_SIGNATURE.get(signature(graph, ids)) || null;
  return { complete, entry, formula: entry ? entry.formula : f, name: entry ? entry.name : 'Unnamed structure' };
}
