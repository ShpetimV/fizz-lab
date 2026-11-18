// Bonding rules. Pure module: no DOM, no Three.js.
//
// Model (deliberately simple, but every rule is real chemistry):
//  * Each element forms a fixed number of bonds (its valence): H 1, C 4, N 3, O 2, Cl 1, Na 1.
//  * Two non-metal atoms with free valence share electrons (covalent bond). The bond
//    order is the largest both can afford, up to a triple bond: O + O → O=O,
//    N + N → N≡N, but CH3 + CH3 → a single C–C bond.
//  * Sodium is a metal: it does not share, it hands its one valence electron to a
//    non-metal partner (ionic bond), leaving Na⁺ and an anion.
//  * An atom whose valence is satisfied refuses further bonds.
//  * Atoms already in the same molecule do not bond again (no rings in this model).
import { ELEMENTS, isElement } from './elements.js';

export class ChemGraph {
  constructor() {
    this.atoms = new Map(); // id -> { id, el, charge }
    this.bonds = []; // { a, b, order, type: 'covalent' | 'ionic', dative?: boolean }
    this._nextId = 1;
  }

  addAtom(el) {
    if (!isElement(el)) throw new Error(`Unknown element: ${el}`);
    const atom = { id: this._nextId++, el, charge: 0 };
    this.atoms.set(atom.id, atom);
    return atom;
  }

  atom(id) {
    return this.atoms.get(id);
  }

  /** Remove an atom together with any bonds it has (partners' ionic charges are restored). */
  removeAtom(id) {
    for (const bond of this.bondsOf(id)) this._unlink(bond);
    this.atoms.delete(id);
  }

  bondsOf(id) {
    return this.bonds.filter((b) => b.a === id || b.b === id);
  }

  bondBetween(a, b) {
    return this.bonds.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)) || null;
  }

  /** @returns {{id: number, bond: object}[]} */
  neighbors(id) {
    const out = [];
    for (const bond of this.bonds) {
      if (bond.a === id) out.push({ id: bond.b, bond });
      else if (bond.b === id) out.push({ id: bond.a, bond });
    }
    return out;
  }

  /** Sum of covalent bond orders at an atom. */
  covalentOrderSum(id) {
    let sum = 0;
    for (const bond of this.bonds) {
      if (bond.type === 'covalent' && (bond.a === id || bond.b === id)) sum += bond.order;
    }
    return sum;
  }

  /**
   * How many covalent bonds this atom can hold given its charge. A non-metal
   * that gained an electron needs one bond fewer (Cl⁻: 0, O⁻: 1); one that lost
   * an electron needs one more (O⁺ behaves like N). Na⁺ has nothing left to give.
   */
  capacity(id) {
    const atom = this.atoms.get(id);
    const e = ELEMENTS[atom.el];
    return Math.max(0, e.metal ? e.valence - atom.charge : e.valence + atom.charge);
  }

  freeValence(id) {
    const atom = this.atoms.get(id);
    if (ELEMENTS[atom.el].metal) return this.capacity(id);
    return Math.max(0, this.capacity(id) - this.covalentOrderSum(id));
  }

  /** Non-bonding electron pairs on an atom (drives VSEPR geometry). */
  lonePairs(id) {
    const atom = this.atoms.get(id);
    const e = ELEMENTS[atom.el];
    if (e.metal) return 0;
    const nonBonding = e.valenceElectrons - atom.charge - this.covalentOrderSum(id) - this.freeValence(id);
    return Math.max(0, Math.floor(nonBonding / 2));
  }

  /** Atom ids + bonds of the connected fragment containing `id`. */
  component(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.pop();
      for (const n of this.neighbors(cur)) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          queue.push(n.id);
        }
      }
    }
    const atoms = [...seen];
    return { atoms, bonds: this.bonds.filter((b) => seen.has(b.a)) };
  }

  sameComponent(a, b) {
    return this.component(a).atoms.includes(b);
  }

  /**
   * Would atoms a and b bond? Never mutates.
   * @returns {{ok: true, type: 'covalent'|'ionic', order: number, donor?: number, acceptor?: number}
   *          |{ok: false, code: string, atom?: number}}
   */
  checkBond(a, b) {
    if (a === b) return { ok: false, code: 'same' };
    const A = this.atoms.get(a);
    const B = this.atoms.get(b);
    if (!A || !B) return { ok: false, code: 'missing' };
    if (this.sameComponent(a, b)) return { ok: false, code: 'same' };
    const mA = ELEMENTS[A.el].metal;
    const mB = ELEMENTS[B.el].metal;
    if (mA && mB) return { ok: false, code: 'metallic' };
    const fa = this.freeValence(a);
    const fb = this.freeValence(b);
    if (mA || mB) {
      const donor = mA ? a : b;
      const acceptor = mA ? b : a;
      if (this.freeValence(donor) < 1) return { ok: false, code: 'ion', atom: donor };
      if (this.freeValence(acceptor) < 1) return { ok: false, code: 'full', atom: acceptor };
      return { ok: true, type: 'ionic', order: 1, donor, acceptor };
    }
    if (fa < 1) return { ok: false, code: 'full', atom: a };
    if (fb < 1) return { ok: false, code: 'full', atom: b };
    return { ok: true, type: 'covalent', order: Math.min(fa, fb, 3) };
  }

  /** Form the bond if the rules allow it. Returns checkBond's result plus the bond. */
  bond(a, b) {
    const res = this.checkBond(a, b);
    if (!res.ok) return res;
    const bond = { a, b, order: res.order, type: res.type };
    if (res.type === 'ionic') {
      // electron transfer: the metal becomes a cation, the partner an anion
      bond.a = res.donor;
      bond.b = res.acceptor;
      this.atoms.get(res.donor).charge += 1;
      this.atoms.get(res.acceptor).charge -= 1;
    }
    this.bonds.push(bond);
    return { ...res, bond };
  }

  _unlink(bond) {
    const i = this.bonds.indexOf(bond);
    if (i < 0) return;
    this.bonds.splice(i, 1);
    if (bond.type === 'ionic') {
      this.atoms.get(bond.a).charge -= 1;
      this.atoms.get(bond.b).charge += 1;
    } else if (bond.dative) {
      // undo the formal charges of a dative closure (C≡O)
      for (const id of [bond.a, bond.b]) this.atoms.get(id).charge = 0;
    }
  }

  /** Break every bond of the fragment containing `id`; all its atoms become neutral and free. */
  breakComponent(id) {
    const comp = this.component(id);
    for (const bond of comp.bonds) this._unlink(bond);
    for (const atomId of comp.atoms) this.atoms.get(atomId).charge = 0;
    return comp.atoms;
  }

  /** A fragment is a complete molecule when it has ≥ 2 atoms and no free valence anywhere. */
  isComplete(ids) {
    if (ids.length < 2) return false;
    return ids.every((id) => this.freeValence(id) === 0);
  }

  /**
   * Carbon monoxide is the one common molecule simple valence counting cannot
   * finish: C=O leaves carbon two bonds short. In reality oxygen donates one of
   * its lone pairs into a third (dative) bond, giving C≡O with formal charges
   * C⁻ / O⁺. This reports whether a fragment is exactly that lone C=O pair.
   */
  canStabilizeCO(ids) {
    if (ids.length !== 2) return false;
    const [x, y] = ids.map((id) => this.atoms.get(id));
    const els = [x.el, y.el].sort().join('');
    if (els !== 'CO' || x.charge !== 0 || y.charge !== 0) return false;
    const bond = this.bondBetween(x.id, y.id);
    return !!bond && bond.type === 'covalent' && bond.order === 2;
  }

  /** Apply the dative closure C=O → C≡O. Returns the bond, or null if not applicable. */
  stabilizeCO(ids) {
    if (!this.canStabilizeCO(ids)) return null;
    const bond = this.bondBetween(ids[0], ids[1]);
    const c = ids.find((id) => this.atoms.get(id).el === 'C');
    const o = ids.find((id) => this.atoms.get(id).el === 'O');
    bond.order = 3;
    bond.dative = true;
    bond.donor = o;
    this.atoms.get(c).charge = -1;
    this.atoms.get(o).charge = 1;
    return bond;
  }

  /** Low-level link used to describe known structures; bypasses the bonding rules. */
  _link(a, b, order = 1, type = 'covalent') {
    const bond = { a, b, order, type };
    if (type === 'ionic') {
      this.atoms.get(a).charge += 1;
      this.atoms.get(b).charge -= 1;
    }
    this.bonds.push(bond);
    return bond;
  }
}

// ---------------------------------------------------------------- formulas
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
export const subscript = (n) => String(n).split('').map((d) => SUB[+d]).join('');

/** Element counts of a fragment: { C: 1, H: 4 }. */
export function composition(graph, ids) {
  const counts = {};
  for (const id of ids) {
    const el = graph.atom(id).el;
    counts[el] = (counts[el] || 0) + 1;
  }
  return counts;
}

/**
 * Formula string. With carbon: Hill order (C, H, then alphabetical).
 * Without carbon: cation first, then the usual inorganic ordering.
 */
export function formula(graph, ids, { plain = false } = {}) {
  const counts = composition(graph, ids);
  const order = counts.C ? ['C', 'H', 'Cl', 'N', 'Na', 'O'] : ['Na', 'N', 'H', 'O', 'Cl'];
  let out = '';
  for (const el of order) {
    const n = counts[el];
    if (!n) continue;
    out += el + (n > 1 ? (plain ? n : subscript(n)) : '');
  }
  return out;
}

/** Human-readable reason for a refused bond. */
export function rejectionText(graph, res) {
  const describe = (id) => {
    const atom = graph.atom(id);
    const e = ELEMENTS[atom.el];
    if (atom.charge !== 0) {
      const sign = atom.charge > 0 ? '⁺' : '⁻';
      return `${e.symbol}${sign} is an ion, its outer shell is already settled`;
    }
    const used = graph.covalentOrderSum(id);
    return `${e.name} valence full (${used}/${e.valence} bond${e.valence > 1 ? 's' : ''})`;
  };
  switch (res.code) {
    case 'full':
      return describe(res.atom);
    case 'ion':
      return 'Na⁺ has no valence electron left to give';
    case 'metallic':
      return 'Na + Na: metallic bonding needs a whole lattice, not modelled here';
    case 'same':
      return 'Already part of the same molecule';
    default:
      return 'No bond possible';
  }
}
