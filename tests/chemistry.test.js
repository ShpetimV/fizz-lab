import { describe, it, expect } from 'vitest';
import {
  ChemGraph, CATALOG, CORE_COUNT, ELEMENTS, identify, signature, buildEntry, formula,
  layoutMolecule, describeCentre, TETRAHEDRAL, rejectionText,
} from '../src/chemistry/index.js';
import { v3 } from '../src/core/math.js';

const DEG = 180 / Math.PI;

/** Assemble a catalogue entry atom by atom using only the public bonding rules. */
function assemble(entry) {
  const g = new ChemGraph();
  const ids = entry.atoms.map((el) => g.addAtom(el).id);
  for (const [i, j] of entry.bonds) {
    const res = g.bond(ids[i], ids[j]);
    if (!res.ok) throw new Error(`${entry.id}: bond ${i}-${j} refused (${res.code})`);
  }
  if (entry.dative) g.stabilizeCO(ids);
  return { g, ids };
}

const byId = (id) => CATALOG.find((e) => e.id === id);
const build = (id) => assemble(byId(id));

function angleAt(layout, centre, a, b) {
  const p = layout.positions;
  return v3.angle(v3.sub(p.get(a), p.get(centre)), v3.sub(p.get(b), p.get(centre))) * DEG;
}

function dihedral(p0, p1, p2, p3) {
  const b0 = v3.sub(p0, p1);
  const b1 = v3.norm(v3.sub(p2, p1));
  const b2 = v3.sub(p3, p2);
  const v = v3.sub(b0, v3.scale(b1, v3.dot(b0, b1)));
  const w = v3.sub(b2, v3.scale(b1, v3.dot(b2, b1)));
  return Math.atan2(v3.dot(v3.cross(b1, v), w), v3.dot(v, w)) * DEG;
}

/** Layout of a catalogue molecule plus helpers to pick atoms by element. */
function laidOut(id) {
  const entry = byId(id);
  const { g, ids } = assemble(entry);
  const layout = layoutMolecule(g, ids, { angles: entry.angles, dihedral: entry.dihedral, approx: entry.approx });
  const of = (el) => ids.filter((x) => g.atom(x).el === el);
  return { g, ids, layout, of, entry };
}

// ------------------------------------------------------------------ valence
describe('valence rules', () => {
  it('uses the real valences H1 C4 N3 O2 Cl1 Na1', () => {
    const g = new ChemGraph();
    const expected = { H: 1, C: 4, N: 3, O: 2, Cl: 1, Na: 1 };
    for (const [el, v] of Object.entries(expected)) {
      expect(ELEMENTS[el].valence).toBe(v);
      expect(g.freeValence(g.addAtom(el).id)).toBe(v);
    }
  });

  it('shows the real number of valence electrons', () => {
    const expected = { H: 1, C: 4, N: 5, O: 6, Cl: 7, Na: 1 };
    for (const [el, n] of Object.entries(expected)) expect(ELEMENTS[el].valenceElectrons).toBe(n);
  });

  it('a hydrogen with one bond refuses another', () => {
    const g = new ChemGraph();
    const [a, b, c] = ['H', 'H', 'H'].map((el) => g.addAtom(el).id);
    expect(g.bond(a, b).ok).toBe(true);
    const res = g.checkBond(a, c);
    expect(res).toMatchObject({ ok: false, code: 'full', atom: a });
    expect(rejectionText(g, res)).toContain('Hydrogen valence full');
  });

  it('a complete molecule repels new atoms', () => {
    const { g, ids } = build('H2O');
    const h = g.addAtom('H').id;
    for (const id of ids) expect(g.checkBond(id, h).ok).toBe(false);
    const { g: g2, ids: ids2 } = build('CH4');
    const cl = g2.addAtom('Cl').id;
    expect(g2.checkBond(ids2[0], cl)).toMatchObject({ ok: false, code: 'full', atom: ids2[0] });
  });

  it('carbon accepts exactly four hydrogens', () => {
    const g = new ChemGraph();
    const c = g.addAtom('C').id;
    for (let i = 0; i < 4; i++) {
      expect(g.freeValence(c)).toBe(4 - i);
      expect(g.bond(c, g.addAtom('H').id).ok).toBe(true);
    }
    expect(g.freeValence(c)).toBe(0);
    expect(g.bond(c, g.addAtom('H').id).ok).toBe(false);
  });

  it('never bonds two atoms of the same molecule again (no rings)', () => {
    const g = new ChemGraph();
    const [a, b, c] = ['O', 'O', 'O'].map((el) => g.addAtom(el).id);
    g._link(a, b, 1);
    g._link(b, c, 1);
    expect(g.checkBond(a, c)).toMatchObject({ ok: false, code: 'same' });
  });

  it('checkBond never mutates the graph', () => {
    const g = new ChemGraph();
    const na = g.addAtom('Na').id;
    const cl = g.addAtom('Cl').id;
    g.checkBond(na, cl);
    expect(g.bonds).toHaveLength(0);
    expect(g.atom(na).charge).toBe(0);
  });

  it('counts lone pairs correctly', () => {
    const { g, ids } = build('H2O');
    expect(g.lonePairs(ids[0])).toBe(2);
    const nh3 = build('NH3');
    expect(nh3.g.lonePairs(nh3.ids[0])).toBe(1);
    const ch4 = build('CH4');
    expect(ch4.g.lonePairs(ch4.ids[0])).toBe(0);
    const hcl = build('HCl');
    expect(hcl.g.lonePairs(hcl.ids[1])).toBe(3);
  });
});

// ------------------------------------------------------------------ bond orders
describe('bond orders', () => {
  const orderOf = (a, b) => {
    const g = new ChemGraph();
    return g.bond(g.addAtom(a).id, g.addAtom(b).id);
  };

  it('H–H and Cl–Cl are single bonds', () => {
    expect(orderOf('H', 'H')).toMatchObject({ ok: true, type: 'covalent', order: 1 });
    expect(orderOf('Cl', 'Cl')).toMatchObject({ ok: true, type: 'covalent', order: 1 });
  });

  it('O=O is a double bond and N≡N a triple bond', () => {
    expect(orderOf('O', 'O').order).toBe(2);
    expect(orderOf('N', 'N').order).toBe(3);
  });

  it('never exceeds a triple bond', () => {
    expect(orderOf('C', 'C').order).toBe(3);
  });

  it('builds O=C=O with two double bonds', () => {
    const { g, ids } = build('CO2');
    expect(g.bonds.map((b) => b.order)).toEqual([2, 2]);
    expect(g.isComplete(ids)).toBe(true);
  });

  it('builds H–C≡N', () => {
    const { g, ids } = build('HCN');
    const [c, n, h] = ids;
    expect(g.bondBetween(c, n).order).toBe(3);
    expect(g.bondBetween(c, h).order).toBe(1);
  });

  it('bond order adapts to the valence that is left: ethane, ethene, ethyne', () => {
    expect(build('C2H6').g.bonds.at(-1).order).toBe(1);
    expect(build('C2H4').g.bonds.at(-1).order).toBe(2);
    const { g, ids } = build('C2H2');
    expect(g.bondBetween(ids[0], ids[1]).order).toBe(3);
  });

  it('every catalogue molecule assembles with exactly the declared bond orders', () => {
    for (const entry of CATALOG) {
      const { g, ids } = assemble(entry);
      entry.bonds.forEach(([i, j, order, type]) => {
        const bond = g.bondBetween(ids[i], ids[j]);
        expect(bond, `${entry.id} ${i}-${j}`).toBeTruthy();
        expect(bond.order, `${entry.id} ${i}-${j}`).toBe(order);
        expect(bond.type).toBe(type || 'covalent');
      });
      expect(g.isComplete(ids), entry.id).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ ionic
describe('ionic bonding', () => {
  it('Na + Cl transfers an electron instead of sharing', () => {
    const g = new ChemGraph();
    const na = g.addAtom('Na').id;
    const cl = g.addAtom('Cl').id;
    const res = g.bond(cl, na);
    expect(res).toMatchObject({ ok: true, type: 'ionic', donor: na, acceptor: cl });
    expect(g.atom(na).charge).toBe(1);
    expect(g.atom(cl).charge).toBe(-1);
    expect(g.covalentOrderSum(cl)).toBe(0);
    expect(g.isComplete([na, cl])).toBe(true);
    expect(g.lonePairs(cl)).toBe(4); // full octet
  });

  it('Na–Na is refused (metallic bonding is not modelled)', () => {
    const g = new ChemGraph();
    expect(g.checkBond(g.addAtom('Na').id, g.addAtom('Na').id)).toMatchObject({ ok: false, code: 'metallic' });
  });

  it('Na⁺ and Cl⁻ refuse further bonds', () => {
    const { g, ids } = build('NaCl');
    expect(g.checkBond(ids[0], g.addAtom('Cl').id)).toMatchObject({ ok: false, code: 'ion' });
    expect(g.checkBond(ids[1], g.addAtom('H').id)).toMatchObject({ ok: false, code: 'full' });
  });

  it('NaOH is Na⁺ with a covalently bonded OH⁻', () => {
    const { g, ids } = build('NaOH');
    const [na, o, h] = ids;
    expect(g.bondBetween(na, o).type).toBe('ionic');
    expect(g.bondBetween(o, h).type).toBe('covalent');
    expect(g.atom(na).charge).toBe(1);
    expect(g.atom(o).charge).toBe(-1);
    expect(g.atom(h).charge).toBe(0);
  });

  it('breaking a molecule returns every atom to neutral with full valence', () => {
    const { g, ids } = build('NaOH');
    g.breakComponent(ids[0]);
    expect(g.bonds).toHaveLength(0);
    for (const id of ids) {
      expect(g.atom(id).charge).toBe(0);
      expect(g.freeValence(id)).toBe(ELEMENTS[g.atom(id).el].valence);
    }
  });
});

// ------------------------------------------------------------------ recognition
describe('molecule recognition', () => {
  const required = ['H2', 'O2', 'N2', 'Cl2', 'HCl', 'H2O', 'H2O2', 'CO2', 'CO', 'CH4', 'NH3', 'HCN', 'C2H6', 'C2H4', 'C2H2', 'CH3OH', 'NaCl', 'NaOH'];

  it('the core catalogue is exactly the 18 required molecules', () => {
    expect(CORE_COUNT).toBe(18);
    expect(CATALOG.filter((e) => !e.bonus).map((e) => e.id).sort()).toEqual([...required].sort());
  });

  it.each(required)('recognises %s when assembled from atoms', (id) => {
    const { g, ids } = build(id);
    const found = identify(g, ids);
    expect(found.complete).toBe(true);
    expect(found.entry?.id).toBe(id);
  });

  it('recognition ignores the order atoms were added in', () => {
    const g = new ChemGraph();
    const h1 = g.addAtom('H').id;
    const h2 = g.addAtom('H').id;
    const o = g.addAtom('O').id;
    g.bond(h1, o);
    g.bond(o, h2);
    expect(identify(g, [h2, o, h1]).entry.id).toBe('H2O');
  });

  it('does not name unfinished fragments', () => {
    const g = new ChemGraph();
    const o = g.addAtom('O').id;
    const h = g.addAtom('H').id;
    g.bond(o, h);
    const found = identify(g, [o, h]);
    expect(found.complete).toBe(false);
    expect(found.entry).toBeNull();
  });

  it('labels valid but unlisted molecules as unnamed structures with a formula', () => {
    const g = new ChemGraph();
    const n = g.addAtom('N').id;
    const cls = [0, 1, 2].map(() => g.addAtom('Cl').id);
    for (const cl of cls) expect(g.bond(n, cl).ok).toBe(true);
    const found = identify(g, [n, ...cls]);
    expect(found).toMatchObject({ complete: true, entry: null, name: 'Unnamed structure', formula: 'NCl₃' });
  });

  it('tells isomers apart by connectivity: ethanol vs dimethyl ether', () => {
    const ethanol = build('C2H5OH');
    const ether = build('CH3OCH3');
    expect(formula(ethanol.g, ethanol.ids)).toBe(formula(ether.g, ether.ids));
    expect(identify(ethanol.g, ethanol.ids).entry.id).toBe('C2H5OH');
    expect(identify(ether.g, ether.ids).entry.id).toBe('CH3OCH3');
  });

  it('C=O alone is unfinished; the dative closure makes it carbon monoxide', () => {
    const g = new ChemGraph();
    const c = g.addAtom('C').id;
    const o = g.addAtom('O').id;
    expect(g.bond(c, o).order).toBe(2);
    expect(g.isComplete([c, o])).toBe(false);
    expect(g.canStabilizeCO([c, o])).toBe(true);
    const bond = g.stabilizeCO([c, o]);
    expect(bond.order).toBe(3);
    expect(g.atom(c).charge).toBe(-1);
    expect(g.atom(o).charge).toBe(1);
    expect(identify(g, [c, o]).entry.id).toBe('CO');
    expect(g.checkBond(c, g.addAtom('O').id).ok).toBe(false); // now saturated
  });

  it('a C=O that still has hydrogens on it is not eligible for the CO closure', () => {
    const { g, ids } = build('CH2O');
    expect(g.canStabilizeCO(ids)).toBe(false);
    expect(identify(g, ids).entry.id).toBe('CH2O');
  });

  it('every catalogue entry has a unique signature and round-trips', () => {
    const seen = new Set();
    for (const entry of CATALOG) {
      const { graph, ids } = buildEntry(entry);
      const sig = signature(graph, ids);
      expect(seen.has(sig)).toBe(false);
      seen.add(sig);
      expect(identify(graph, ids).entry.id).toBe(entry.id);
    }
  });

  it('writes formulas conventionally', () => {
    const f = (id) => {
      const { g, ids } = build(id);
      return formula(g, ids, { plain: true });
    };
    expect(f('H2O')).toBe('H2O');
    expect(f('CH4')).toBe('CH4');
    expect(f('NaCl')).toBe('NaCl');
    expect(f('NH3')).toBe('NH3');
    expect(f('C2H6')).toBe('C2H6');
    expect(f('CO2')).toBe('CO2');
  });
});

// ------------------------------------------------------------------ geometry
describe('VSEPR geometry', () => {
  it('H2O is bent at 104.5°', () => {
    const { layout, of } = laidOut('H2O');
    const [h1, h2] = of('H');
    expect(angleAt(layout, of('O')[0], h1, h2)).toBeCloseTo(104.5, 4);
    expect(layout.angles[0].label).toBe('104.5°');
  });

  it('NH3 is trigonal pyramidal at 107°', () => {
    const { layout, of } = laidOut('NH3');
    const n = of('N')[0];
    const [a, b, c] = of('H');
    expect(angleAt(layout, n, a, b)).toBeCloseTo(107, 4);
    expect(angleAt(layout, n, b, c)).toBeCloseTo(107, 4);
    expect(angleAt(layout, n, a, c)).toBeCloseTo(107, 4);
    // pyramidal, not flat: N sits out of the H3 plane
    const p = layout.positions;
    const normal = v3.norm(v3.cross(v3.sub(p.get(b), p.get(a)), v3.sub(p.get(c), p.get(a))));
    expect(Math.abs(v3.dot(v3.sub(p.get(n), p.get(a)), normal))).toBeGreaterThan(0.2);
    expect(layout.angles[0].label).toBe('107°');
  });

  it('CH4 is tetrahedral at 109.5°', () => {
    const { layout, of } = laidOut('CH4');
    const c = of('C')[0];
    const hs = of('H');
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expect(angleAt(layout, c, hs[i], hs[j])).toBeCloseTo(TETRAHEDRAL, 4);
    }
    expect(TETRAHEDRAL).toBeCloseTo(109.47, 2);
    expect(layout.angles[0].label).toBe('109.5°');
  });

  it('CO2 is linear at 180°', () => {
    const { layout, of } = laidOut('CO2');
    const [o1, o2] = of('O');
    expect(angleAt(layout, of('C')[0], o1, o2)).toBeCloseTo(180, 4);
    expect(layout.angles[0].label).toBe('180°');
  });

  it('HCN is linear at 180°', () => {
    const { layout, of } = laidOut('HCN');
    expect(angleAt(layout, of('C')[0], of('H')[0], of('N')[0])).toBeCloseTo(180, 4);
  });

  it('C2H2 is linear at 180°', () => {
    const { layout, ids } = laidOut('C2H2');
    const [c1, c2, h1, h2] = ids;
    expect(angleAt(layout, c1, c2, h1)).toBeCloseTo(180, 4);
    expect(angleAt(layout, c2, c1, h2)).toBeCloseTo(180, 4);
  });

  it('C2H4 is trigonal planar (120°) with all six atoms in one plane', () => {
    const { layout, ids } = laidOut('C2H4');
    const [c1, c2, h1, h2, h3, h4] = ids;
    expect(angleAt(layout, c1, h1, h2)).toBeCloseTo(120, 4);
    expect(angleAt(layout, c1, c2, h1)).toBeCloseTo(120, 4);
    expect(angleAt(layout, c2, h3, h4)).toBeCloseTo(120, 4);
    const p = layout.positions;
    const normal = v3.norm(v3.cross(v3.sub(p.get(c2), p.get(c1)), v3.sub(p.get(h1), p.get(c1))));
    for (const id of ids) expect(Math.abs(v3.dot(v3.sub(p.get(id), p.get(c1)), normal))).toBeLessThan(1e-6);
    expect(layout.angles[0].label).toBe('≈120°');
  });

  it('C2H6 has tetrahedral carbons in a staggered conformation', () => {
    const { layout, ids } = laidOut('C2H6');
    const [c1, c2, h1, h2, , h4] = ids;
    expect(angleAt(layout, c1, h1, h2)).toBeCloseTo(TETRAHEDRAL, 4);
    expect(angleAt(layout, c1, c2, h1)).toBeCloseTo(TETRAHEDRAL, 4);
    const p = layout.positions;
    const d = Math.abs(dihedral(p.get(h1), p.get(c1), p.get(c2), p.get(h4)));
    const staggered = [60, 180].some((t) => Math.abs(d - t) < 1e-3);
    expect(staggered).toBe(true);
  });

  it('H2O2 is a twisted open book: H–O–O 94.8°, dihedral 111.5°', () => {
    const { layout, ids } = laidOut('H2O2');
    const [o1, o2, h1, h2] = ids;
    expect(angleAt(layout, o1, o2, h1)).toBeCloseTo(94.8, 4);
    expect(angleAt(layout, o2, o1, h2)).toBeCloseTo(94.8, 4);
    const p = layout.positions;
    expect(Math.abs(dihedral(p.get(h1), p.get(o1), p.get(o2), p.get(h2)))).toBeCloseTo(111.5, 3);
  });

  it('CH3OH is tetrahedral at carbon and bent (108.5°) at oxygen', () => {
    const { layout, ids } = laidOut('CH3OH');
    const [c, o, h1, h2, , hO] = ids;
    expect(angleAt(layout, c, h1, h2)).toBeCloseTo(TETRAHEDRAL, 4);
    expect(angleAt(layout, c, o, h1)).toBeCloseTo(TETRAHEDRAL, 4);
    expect(angleAt(layout, o, c, hO)).toBeCloseTo(108.5, 4);
  });

  it('classifies centres by electron domains', () => {
    const shape = (id) => {
      const { g, ids } = build(id);
      return describeCentre(g, ids[0]).shape;
    };
    expect(shape('H2O')).toBe('bent');
    expect(shape('NH3')).toBe('trigonal pyramidal');
    expect(shape('CH4')).toBe('tetrahedral');
    expect(shape('CO2')).toBe('linear');
    expect(shape('C2H4')).toBe('trigonal planar');
  });

  it('cumulated double bonds put the end groups in perpendicular planes (allene)', () => {
    const g = new ChemGraph();
    const [c1, c2, c3] = ['C', 'C', 'C'].map((el) => g.addAtom(el).id);
    const hs = [0, 1, 2, 3].map(() => g.addAtom('H').id);
    g.bond(c1, hs[0]); g.bond(c1, hs[1]); g.bond(c3, hs[2]); g.bond(c3, hs[3]);
    expect(g.bond(c1, c2).order).toBe(2);
    expect(g.bond(c2, c3).order).toBe(2);
    const ids = [c1, c2, c3, ...hs];
    expect(g.isComplete(ids)).toBe(true);
    const layout = layoutMolecule(g, ids, { approx: true });
    expect(angleAt(layout, c2, c1, c3)).toBeCloseTo(180, 4);
    const p = layout.positions;
    const d = Math.abs(dihedral(p.get(hs[0]), p.get(c1), p.get(c3), p.get(hs[2])));
    expect(d).toBeCloseTo(90, 3);
  });

  it('reports one open bonding slot per free valence, pointing where the next atom will go', () => {
    const g = new ChemGraph();
    const c = g.addAtom('C').id;
    expect(layoutMolecule(g, [c]).slots).toHaveLength(4);
    const hs = [0, 1, 2].map(() => g.addAtom('H').id);
    for (const h of hs) g.bond(c, h);
    const ids = [c, ...hs];
    const layout = layoutMolecule(g, ids);
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0].atom).toBe(c);
    // the open position completes the tetrahedron around carbon
    for (const h of hs) {
      const toH = v3.sub(layout.positions.get(h), layout.positions.get(c));
      expect(v3.angle(toH, layout.slots[0].dir) * DEG).toBeCloseTo(TETRAHEDRAL, 3);
    }
    const water = build('H2O');
    expect(layoutMolecule(water.g, water.ids).slots).toHaveLength(0);
    const na = new ChemGraph();
    expect(layoutMolecule(na, [na.addAtom('Na').id]).slots).toHaveLength(1);
  });

  it('keeps bonded atoms at sensible, order-dependent distances', () => {
    const len = (id) => {
      const { layout, ids } = laidOut(id);
      return v3.len(v3.sub(layout.positions.get(ids[0]), layout.positions.get(ids[1])));
    };
    expect(len('C2H2')).toBeLessThan(len('C2H4'));
    expect(len('C2H4')).toBeLessThan(len('C2H6'));
  });

  it('layouts are centred and finite for every catalogue molecule', () => {
    for (const entry of CATALOG) {
      const { g, ids } = assemble(entry);
      const layout = layoutMolecule(g, ids, { angles: entry.angles, dihedral: entry.dihedral, approx: entry.approx });
      let c = [0, 0, 0];
      for (const id of ids) {
        const p = layout.positions.get(id);
        expect(p.every(Number.isFinite), entry.id).toBe(true);
        c = v3.add(c, p);
      }
      expect(v3.len(c) / ids.length).toBeLessThan(1e-6);
      // no two atoms on top of each other
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const d = v3.len(v3.sub(layout.positions.get(ids[i]), layout.positions.get(ids[j])));
          expect(d, `${entry.id} atoms ${i},${j}`).toBeGreaterThan(0.5);
        }
      }
    }
  });
});
