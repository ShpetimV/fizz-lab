// VSEPR geometry. Pure module: no DOM, no Three.js.
//
// Every atom is treated as a VSEPR centre: its electron domains are its
// covalent neighbours (a double / triple bond counts as ONE domain), its lone
// pairs, and — for unfinished fragments — its still-empty bonding positions.
// Domains arrange as far apart as possible:
//   2 domains → linear 180° · 3 → trigonal planar 120° · 4 → tetrahedral 109.5°
// and lone pairs compress the remaining bond angles (107° with one lone pair,
// 104.5° with two), which is what makes NH3 pyramidal and H2O bent.
import { ELEMENTS } from './elements.js';
import { v3, quat } from '../core/math.js';

const DEG = Math.PI / 180;
export const TETRAHEDRAL = Math.acos(-1 / 3) / DEG; // 109.4712°

// Display length per picometre of summed covalent radii.
const LENGTH_SCALE = 0.0096;
const ORDER_FACTOR = { 1: 1, 2: 0.88, 3: 0.8 }; // multiple bonds are shorter
const MIN_GAP = 0.28; // keep room between atom shells for the bond beam

/** Display bond length between two bonded atoms (shorter for higher bond order). */
export function bondLength(graph, a, b) {
  const A = ELEMENTS[graph.atom(a).el];
  const B = ELEMENTS[graph.atom(b).el];
  const bond = graph.bondBetween(a, b);
  const factor = bond && bond.type === 'ionic' ? 0.76 : ORDER_FACTOR[bond ? bond.order : 1];
  const len = (A.covalentRadius + B.covalentRadius) * LENGTH_SCALE * factor;
  return Math.max(len, A.display + B.display + MIN_GAP);
}

/**
 * VSEPR description of one atom.
 * @returns {{cov: number[], ionic: number[], free: number, lonePairs: number,
 *            occupied: number, steric: number, angle: number, shape: string}}
 */
export function describeCentre(graph, id, angleOverrides = {}) {
  const cov = [];
  const ionic = [];
  for (const n of graph.neighbors(id)) (n.bond.type === 'ionic' ? ionic : cov).push(n.id);
  const metal = ELEMENTS[graph.atom(id).el].metal;
  const free = metal ? 0 : graph.freeValence(id);
  const lonePairs = graph.lonePairs(id);
  const occupied = cov.length + free; // bonding positions, filled or still open
  const steric = occupied + lonePairs;
  let angle;
  let shape;
  if (steric <= 2) {
    angle = 180;
    shape = 'linear';
  } else if (steric === 3) {
    angle = 120;
    shape = occupied === 3 ? 'trigonal planar' : 'bent';
  } else {
    angle = lonePairs === 0 ? TETRAHEDRAL : lonePairs === 1 ? 107 : 104.5;
    shape = occupied >= 4 ? 'tetrahedral' : occupied === 3 ? 'trigonal pyramidal' : 'bent';
  }
  const el = graph.atom(id).el;
  if (occupied >= 2 && angleOverrides[el] !== undefined) angle = angleOverrides[el];
  if (occupied < 2) shape = 'terminal';
  return { cov, ionic, free, lonePairs, occupied, steric, angle, shape };
}

/** Unit vectors for the bonding positions of a centre, in a tidy canonical frame. */
function domainDirections(c) {
  const m = c.occupied;
  if (m <= 0) return [];
  if (m === 1) return [[1, 0, 0]];
  const th = c.angle * DEG;
  if (c.steric <= 2) return [[1, 0, 0], [-1, 0, 0]];
  if (m === 2) {
    // bent: symmetric about -Y (the classic "water" view)
    return [[-Math.sin(th / 2), -Math.cos(th / 2), 0], [Math.sin(th / 2), -Math.cos(th / 2), 0]];
  }
  if (c.steric === 3) {
    return [90, 210, 330].map((a) => [Math.cos(a * DEG), Math.sin(a * DEG), 0]);
  }
  if (m === 3) {
    // pyramid: three bonds at mutual angle th, apex (lone pair) pointing +Y
    const cb = Math.sqrt(Math.max(0, (2 * Math.cos(th) + 1) / 3));
    const sb = Math.sqrt(1 - cb * cb);
    return [90, 210, 330].map((a) => [sb * Math.cos(a * DEG), -cb, sb * Math.sin(a * DEG)]);
  }
  // tetrahedron: one bond up, three down
  const ct = -1 / 3;
  const st = Math.sqrt(1 - ct * ct);
  return [[0, 1, 0], ...[90, 210, 330].map((a) => [st * Math.cos(a * DEG), ct, st * Math.sin(a * DEG)])];
}

const formatAngle = (deg, approx) => {
  const s = (Math.round(deg * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${approx ? '≈' : ''}${s}°`;
};

/**
 * Lay a fragment out in 3D.
 *
 * @param graph ChemGraph
 * @param ids   atom ids of one connected fragment
 * @param opts  { angles?: {El: degrees}, dihedral?: degrees, approx?: boolean }
 * @returns {{ positions: Map<number, number[]>, radius: number,
 *             angles: {centre: number, a: number, b: number, degrees: number, label: string}[],
 *             slots: {atom: number, dir: number[]}[] }}
 *          Positions are centred on the fragment's centroid. `slots` are the
 *          still-empty bonding positions (one unit direction per free valence).
 */
export function layoutMolecule(graph, ids, opts = {}) {
  const overrides = opts.angles || {};
  const centres = new Map();
  for (const id of ids) centres.set(id, describeCentre(graph, id, overrides));
  const pos = new Map();
  const slots = [];
  const el = (id) => ELEMENTS[graph.atom(id).el];
  // heavier, better-connected substituents take the first (most prominent) positions
  const rank = (id) => centres.get(id).cov.length * 100 + el(id).Z;
  const sorted = (list) => [...list].sort((a, b) => rank(b) - rank(a) || a - b);

  const isCumulated = (id) => {
    const c = centres.get(id);
    return c.steric <= 2 && c.cov.length === 2 && c.cov.every((n) => graph.bondBetween(id, n).order === 2);
  };

  const dihedralFor = (p, c) => {
    if (opts.dihedral !== undefined) return opts.dihedral * DEG;
    // neighbouring planar centres share one plane (C=C); everything else staggers
    if (centres.get(p).steric === 3 && centres.get(c).steric === 3) return 0;
    return Math.PI;
  };

  // Place child c at the end of unit direction `dir` from parent p. `ref` is a
  // direction at p (roughly perpendicular to dir) that fixes the torsion.
  const place = (p, c, dir, ref) => {
    pos.set(c, v3.add(pos.get(p), v3.scale(dir, bondLength(graph, p, c))));
    const info = centres.get(c);
    let set = domainDirections(info);
    if (!set.length) return;
    const back = v3.scale(dir, -1);
    const q = quat.between(v3.norm(set[0]), back);
    set = set.map((d) => quat.rotate(q, d));
    set[0] = back;
    if (set.length > 1) {
      const rp = v3.sub(ref, v3.scale(dir, v3.dot(ref, dir)));
      const dp = v3.sub(set[1], v3.scale(dir, v3.dot(set[1], dir)));
      if (v3.len(rp) > 1e-4 && v3.len(dp) > 1e-4) {
        const current = Math.atan2(v3.dot(v3.cross(rp, dp), dir), v3.dot(rp, dp));
        const twist = dihedralFor(p, c) - current;
        set = set.map((d, i) => (i === 0 ? d : v3.rotate(d, dir, twist)));
      }
    }
    const kids = sorted(info.cov.filter((n) => n !== p));
    kids.forEach((k, i) => {
      const kd = set[i + 1];
      let r = back;
      if (v3.len(v3.cross(r, kd)) < 1e-3) {
        // straight-through centre: carry the previous reference along the axis;
        // cumulated double bonds (C=C=C) put the two ends in perpendicular planes
        r = v3.norm(v3.sub(ref, v3.scale(kd, v3.dot(ref, kd))));
        if (isCumulated(c)) r = v3.rotate(r, kd, Math.PI / 2);
      }
      place(c, k, kd, r);
    });
    for (let i = kids.length + 1; i < set.length; i++) slots.push({ atom: c, dir: set[i] });
  };

  // ---- covalent skeleton (sodium ions are attached afterwards) ----
  const skeleton = ids.filter((id) => !el(id).metal);
  const root = skeleton.length ? sorted(skeleton)[0] : ids[0];
  pos.set(root, [0, 0, 0]);
  const rootInfo = centres.get(root);
  const rootDirs = domainDirections(rootInfo);
  sorted(rootInfo.cov).forEach((k, i) => {
    const kd = rootDirs[i];
    let ref = rootDirs.length > 1 ? rootDirs[i === 0 ? 1 : 0] : v3.perp(kd);
    if (v3.len(v3.cross(ref, kd)) < 1e-3) {
      ref = v3.perp(kd);
      if (i > 0 && isCumulated(root)) ref = v3.rotate(ref, kd, Math.PI / 2);
    }
    place(root, k, kd, ref);
  });
  for (let i = rootInfo.cov.length; i < rootDirs.length; i++) slots.push({ atom: root, dir: rootDirs[i] });
  // a neutral sodium atom has one electron to give: show that as its single slot
  for (const id of ids) if (el(id).metal && graph.freeValence(id) > 0) slots.push({ atom: id, dir: [1, 0, 0] });

  // ---- ionic partners: opposite the centre's covalent bonds ----
  for (const id of skeleton) {
    const info = centres.get(id);
    if (!info.ionic.length) continue;
    const here = pos.get(id);
    let away = [0, 0, 0];
    for (const n of info.cov) away = v3.add(away, v3.norm(v3.sub(here, pos.get(n))));
    const hasAxis = v3.len(away) > 1e-3;
    const base = hasAxis ? v3.norm(away) : [-1, 0, 0];
    info.ionic.forEach((n, i) => {
      let dir = base;
      if (i > 0) dir = hasAxis ? v3.rotate(base, v3.perp(base), (i * 100) * DEG) : i === 1 ? [1, 0, 0] : [0, i % 2 ? 1 : -1, 0];
      pos.set(n, v3.add(here, v3.scale(dir, bondLength(graph, id, n))));
    });
  }
  for (const id of ids) if (!pos.has(id)) pos.set(id, [0, 0, 0]); // defensive: unreachable for valid fragments

  for (const rotate of present(ids, pos, el)) for (const slot of slots) slot.dir = rotate(slot.dir);

  // ---- bond angles worth annotating: one per multi-bond centre ----
  const angles = [];
  const multi = sorted(ids.filter((id) => centres.get(id).cov.length >= 2));
  for (const id of multi.slice(0, 3)) {
    const [a, b] = sorted(centres.get(id).cov).slice(-2); // prefer the lighter pair (e.g. H–C–H)
    const here = pos.get(id);
    const degrees = v3.angle(v3.sub(pos.get(a), here), v3.sub(pos.get(b), here)) / DEG;
    const exact = Math.abs(degrees - 180) < 1e-6 || (!opts.approx && Math.abs(degrees - TETRAHEDRAL) < 1e-6 && centres.get(id).cov.length === 4);
    angles.push({ centre: id, a, b, degrees, label: formatAngle(degrees, opts.approx && !exact && degrees < 179.9) });
  }

  let radius = 0;
  for (const id of ids) radius = Math.max(radius, v3.len(pos.get(id)) + el(id).display);
  return { positions: pos, angles, radius, centres, slots };
}

/**
 * Rotate the finished layout into a presentation frame: longest axis along X,
 * the widest remaining spread along Y, heavy atoms toward the top. Then centre it.
 * Returns the rotations applied, so directions can be carried along.
 */
function present(ids, pos, el) {
  const applied = [];
  if (ids.length < 2) return applied;
  const heavy = ids.filter((id) => el(id).symbol !== 'H');
  const pool = heavy.length >= 2 ? heavy : ids;
  let best = -1;
  let axis = [1, 0, 0];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const d = v3.sub(pos.get(pool[j]), pos.get(pool[i]));
      const l = v3.len(d);
      if (l > best + 1e-9) {
        best = l;
        axis = v3.scale(d, 1 / l);
      }
    }
  }
  const q1 = quat.between(axis, [1, 0, 0]);
  const spin = (fn) => {
    applied.push(fn);
    for (const id of ids) pos.set(id, fn(pos.get(id)));
  };
  spin((p) => quat.rotate(q1, p));

  // centre on the centroid
  let c = [0, 0, 0];
  for (const id of ids) c = v3.add(c, pos.get(id));
  c = v3.scale(c, 1 / ids.length);
  for (const id of ids) pos.set(id, v3.sub(pos.get(id), c));

  // spin about X so the larger perpendicular spread lies along Y
  let syy = 0, szz = 0, syz = 0;
  for (const id of ids) {
    const p = pos.get(id);
    syy += p[1] * p[1];
    szz += p[2] * p[2];
    syz += p[1] * p[2];
  }
  if (syy + szz > 1e-9) {
    const phi = 0.5 * Math.atan2(2 * syz, syy - szz);
    spin((p) => v3.rotate(p, [1, 0, 0], -phi));
  }
  // heavier atoms up (water: O on top, H's below)
  let wy = 0;
  let wx = 0;
  for (const id of ids) {
    wy += pos.get(id)[1] * el(id).Z;
    wx += pos.get(id)[0] * el(id).Z;
  }
  if (wy < -1e-6) spin((p) => v3.rotate(p, [1, 0, 0], Math.PI));
  // two-atom fragments read lighter atom → heavier atom, left to right (H–Cl, Na–Cl)
  if (ids.length === 2 && wx < -1e-6) spin((p) => v3.rotate(p, [0, 1, 0], Math.PI));
  return applied;
}
