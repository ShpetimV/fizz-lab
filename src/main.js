import * as THREE from 'three';
import { VIEW, QUALITY, COL, TEMP } from './config.js';
import { clamp, damp, easeInOut, OneEuro } from './core/math.js';
import { Stage } from './render/stage.js';
import { AtomBatch, TubeBatch, RingBatch, BeamBatch, BillboardBatch, GlowPoints, Particles, Dust, Grid, BEAM, BB } from './render/batches.js';
import { TextSprites, InfoCard } from './render/text.js';
import { Effects } from './render/fx.js';
import { drawHand } from './render/hands.js';
import { Strip } from './render/strip.js';
import { Electrons } from './render/electrons.js';
import { WaterView, PHASE_TINT } from './render/waterView.js';
import { Tracker } from './tracking/tracker.js';
import { Gestures } from './gestures/gestures.js';
import { MousePointer } from './gestures/mouse.js';
import { World } from './physics/world.js';
import { WaterSim } from './physics/water.js';
import { Hud } from './hud/hud.js';
import { Narrator, PERSONA } from './voice/narrator.js';
import { LINES, greeting, pickLine, repeatLine } from './voice/lines.js';
import { Sfx } from './audio/sfx.js';
import { CATALOG, CORE_COUNT, NOTE, ELEMENTS } from './chemistry/index.js';
import { EMOJI, flairColor, flairInk, rankFor } from './hud/flair.js';
import { LiquidLab } from './liquid/lab.js';
import { MATERIALS } from './liquid/materials.js';
import { BubbleLab, BUBBLE_FACTS } from './bubbles/lab.js';

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('stage');
const video = document.getElementById('cam');
const stage = new Stage(canvas);
const hud = new Hud();
const sfx = new Sfx();
const narrator = new Narrator({
  onLine: (text, append) => hud.subtitle(text, append),
  onEnd: () => hud.subtitleEnd(),
  onThinking: (on) => hud.thinking(on),
  onHeard: (text) => hud.status(text ? `You asked: “${text}”` : 'I didn’t catch that. Hold V and try again.', 9),
  onEngine: (server) => {
    hud.setPersona(server.ok ? server.persona : PERSONA);
    hud.setAsk(server.ok && server.ears);
    if (state.started && server.ok) hud.status(`Voice companion connected · ${server.persona}${server.llm ? ` · ${server.model}` : ''}`);
  },
  audioOut: () => (sfx.ctx ? { ctx: sfx.ctx, node: sfx.master } : null),
});

// shared uniforms
const uTime = { value: 0 };
const uPointScale = { value: stage.pointScale };

const grid = new Grid(stage.scene, uTime, VIEW.halfH);
const dust = new Dust(stage.scene, uTime, uPointScale);
const atoms = new AtomBatch(stage.scene, uTime);
const tubes = new TubeBatch(stage.scene, uTime);
const rings = new RingBatch(stage.scene);
const beams = new BeamBatch(stage.scene, uTime);
const glow = new BillboardBatch(stage.scene, uTime);
// element symbols are printed on the atoms: normal blending so dark ink works on light atoms
const labels = new BillboardBatch(stage.scene, uTime, 512, 15, { blending: THREE.NormalBlending });
const points = new GlowPoints(stage.scene, uPointScale);
const particles = new Particles(stage.scene, uTime, uPointScale);
const text = new TextSprites(stage.scene);
const card = new InfoCard(stage);
const batches = { atoms, tubes, rings, beams, glow, labels, text };
const fx = new Effects({ stage, beams, glow, text, particles, grid });
const strip = new Strip(stage);
const liquidDock = new Strip(stage, []); // the liquids on offer, filled when the liquid lab opens
const electrons = new Electrons(points, rings);

const tracker = new Tracker(video);
const gestures = new Gestures(stage);
const mouse = new MousePointer(stage, canvas);
const pointers = [...gestures.hands, mouse];

const state = {
  started: false,
  mode: 'build', // 'build' | 'liquid' | 'bubbles' | 'water'
  buildMix: 1, // 1 = molecule bench visible
  waterMix: 0, // 0 = assembly bench, 1 = water chamber
  temp: TEMP.start,
  tempLive: false,
  timeScale: 1,
  slowMo: 0, // seconds of slow motion left
  simTime: 0,
  realTime: 0,
  fps: 60,
  lowFpsTime: 0,
  autoDropped: false,
  discovered: new Set(),
  bonus: new Set(),
  said: new Set(), // one-off narration keys
  shot: null, // camera push-in
  head: new THREE.Vector2(),
  headFilter: [new OneEuro(0.9, 4, 1), new OneEuro(0.9, 4, 1), new OneEuro(0.6, 2, 1)],
  face: { on: false, x: 0, y: 0, size: 0.2, lastSeen: -10, stamp: -1, t: 0 },
  tint: [1, 1, 1],
  cameraMode: false,
};

let water = null;
let waterView = null;

// ------------------------------------------------------------------ world events
const once = (key, fn) => {
  if (state.said.has(key)) return false;
  state.said.add(key);
  fn();
  return true;
};

function bondSummary(body) {
  const graph = world.graph;
  const counts = new Map();
  for (const bond of graph.component(body.atoms[0]).bonds) {
    const a = graph.atom(bond.a);
    const b = graph.atom(bond.b);
    let key;
    if (bond.type === 'ionic') key = `${a.el}⁺ ${b.el}⁻ ionic`;
    else {
      const [x, y] = [a.el, b.el].sort((p, q) => ELEMENTS[q].Z - ELEMENTS[p].Z || 0);
      key = `${x}${['', '–', '=', '≡'][bond.order]}${y}${bond.dative ? ' (1 dative)' : ''}`;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} × ${k}`).join('  ·  ');
}

function cardInfo(body, info, fresh) {
  const entry = info.entry;
  if (entry) {
    const index = CATALOG.indexOf(entry);
    return {
      header: fresh ? 'New molecule' : 'From your collection',
      tag: entry.bonus ? 'Bonus find' : `No. ${index + 1} of ${CORE_COUNT}`,
      name: entry.name,
      formula: entry.formula,
      emoji: EMOJI[entry.id],
      color: flairColor(index),
      ink: flairInk(index),
      rows: [['Shape', entry.shape], ['Bond angle', entry.angle], ['Bonds', bondSummary(body)]],
      fact: entry.fact,
      note: NOTE,
    };
  }
  const angles = body.angles.map((a) => a.label).join(' · ') || '— (no bond angle)';
  return {
    header: 'Your own invention',
    tag: 'Not in the catalogue',
    name: 'Unnamed structure',
    formula: info.formula,
    emoji: '✨',
    color: 'rgb(142, 142, 147)',
    rows: [['Shape', 'VSEPR estimate'], ['Bond angle', angles], ['Bonds', bondSummary(body)]],
    fact: 'Every atom here has its valence satisfied, so this structure is allowed by the bonding rules. It is simply not one of the molecules in this lab’s catalogue. The angles shown are ideal VSEPR estimates.',
    note: NOTE,
  };
}

// ---- narration helpers ------------------------------------------------------
// Each remark is sent to the narrator as: what happened + verified facts. With
// the voice companion running, a local LLM words it; otherwise `canned` is read.
const plain = (text) => text.replace(/[₀-₉]/g, (d) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(d));
const VALENCE_FACT = 'Each element forms a fixed number of bonds: hydrogen 1, carbon 4, nitrogen 3, oxygen 2, chlorine 1, sodium 1.';

function tell(canned, { event, facts, must, priority = false, key, reset = false } = {}) {
  narrator.narrate({ canned, event, facts: facts === undefined ? canned : facts, must, priority, key, reset });
}

function aside(canned, gap, { event, facts } = {}) {
  return narrator.remark({ canned, event, facts: facts === undefined ? canned : facts }, state.realTime, gap);
}

function describeBody(body) {
  if (!body) return 'something';
  const g = world.graph;
  if (body.atoms.length === 1) {
    const atom = g.atom(body.atoms[0]);
    return `a lone ${ELEMENTS[atom.el].name.toLowerCase()} atom`;
  }
  if (body.complete && body.info) return body.info.entry ? `a finished ${body.info.name.toLowerCase()} molecule` : `a finished unnamed molecule (${plain(body.info.formula)})`;
  let free = 0;
  for (const id of body.atoms) free += g.freeValence(id);
  return `an unfinished fragment ${plain(body.info?.formula || '')} with ${free} open bond${free === 1 ? '' : 's'}`;
}

function rejectionFact(res) {
  const g = world.graph;
  if (res.code === 'metallic') return 'Two sodium atoms do not form a molecule. Sodium atoms bond metallically in a whole lattice, which this lab does not model.';
  if (res.code === 'ion') return 'That sodium is already an ion: it had exactly one valence electron to give and has given it away.';
  if (res.code === 'full' && res.atom) {
    const atom = g.atom(res.atom);
    const el = ELEMENTS[atom.el];
    if (atom.charge !== 0) return `That ${el.name.toLowerCase()} is an ion whose outer shell is already full, so it accepts no further bonds.`;
    return `${el.name} forms exactly ${el.valence} bond${el.valence > 1 ? 's' : ''} and already has ${g.covalentOrderSum(res.atom)}, so its valence is full.`;
  }
  return 'Those atoms are already part of the same molecule.';
}

/** Plain-language snapshot of the lab, sent along with spoken questions. */
function labState() {
  const t = `${state.temp.toFixed(0)} degrees Celsius`;
  if (state.mode === 'liquid') return liquid.describe();
  if (state.mode === 'bubbles') return bubbles.describe();
  if (state.mode === 'water' && water) {
    return `The player is in the water chamber: 40 water molecules at ${t}, currently ${water.phase.toLowerCase()}, about ${water.bondsPerMolecule().toFixed(1)} hydrogen bonds per molecule.`;
  }
  const items = [...world.bodies.values()].slice(0, 14).map(describeBody);
  const core = CATALOG.filter((e) => !e.bonus);
  const found = core.filter((e) => state.discovered.has(e.id)).map((e) => e.name);
  const missing = core.filter((e) => !state.discovered.has(e.id)).map((e) => e.name);
  return `Assembly bench at ${t}. On the bench: ${items.join(', ') || 'nothing yet'}. Catalogued ${found.length} of ${CORE_COUNT}: ${found.join(', ') || 'none'}. Not yet found: ${missing.join(', ') || 'none'}.`;
}

const REFERENCE = [
  VALENCE_FACT,
  'Sodium bonds ionically: it gives its one electron away instead of sharing. Atoms bond when touched together if both have an open bonding position; a finished molecule refuses more atoms.',
  ...CATALOG.filter((e) => !e.bonus).map((e) => `${e.name} (${e.id}): ${e.shape}; bond angle ${e.angle}; to build: ${plain(e.recipe)}.`),
  'Liquid metal lab: the liquid can be pulled apart into droplets that merge again, because surface tension pulls a liquid toward the smallest surface. Only the ferrofluid responds to a magnet.',
  ...MATERIALS.map((m) => `${m.name}: ${m.fact}`),
  `Bubble lab: ${Object.values(BUBBLE_FACTS).join(' ')}`,
  'Water chamber: ice below 0 degrees Celsius, liquid up to 100, steam above. Ice is an open hexagonal lattice with four hydrogen-bonded neighbours per molecule, which makes it less dense than liquid water.',
].join(' ');

const events = {
  onSpawn(atom, el) {
    sfx.spawn();
    const n = el.valenceElectrons;
    hud.status(`${el.name} · ${n} valence electron${n > 1 ? 's' : ''} · makes ${el.valence} bond${el.valence > 1 ? 's' : ''}`);
    electrons.addAtom(atom.id, n, Math.random());
    once('firstAtom', () => tell(LINES.firstAtom, {
      event: `The player pulled out their first atom: ${el.name}.`,
      facts: `${el.name} has ${n} valence electron${n > 1 ? 's' : ''}, drawn orbiting it in a simplified Bohr-style picture, and forms ${el.valence} bond${el.valence > 1 ? 's' : ''}.`,
    }));
  },
  onGrab(body) {
    sfx.pinch();
    if (body.complete && body.info && card.bodyId !== body.id) card.show(cardInfo(body, body.info, false), body.id, 7);
  },
  onRelease() {
    sfx.release();
  },
  onArc() {
    sfx.crackle();
  },
  onBond(res, va, vb) {
    electrons.onBond(res);
    if (res.type === 'ionic') {
      sfx.zap();
      hud.status(`Ionic bond · ${va.el.symbol} gives one electron to ${vb.el.symbol} · nothing is shared`);
    } else {
      sfx.snap(res.order);
      const kind = ['', 'single', 'double', 'triple'][res.order];
      once('firstBond', () => tell(LINES.firstBond, {
        event: `The player made their first bond: a ${kind} covalent bond between ${va.el.name.toLowerCase()} and ${vb.el.name.toLowerCase()}.`,
        facts: 'In a covalent bond two atoms share electrons: one shared pair per bond, one electron from each atom. The electrons can be seen moving into the bond.',
      }));
    }
  },
  onFragment(body, info) {
    if (info.complete) return;
    let free = 0;
    for (const id of body.atoms) free += world.graph.freeValence(id);
    const kind = ['', 'Single', 'Double', 'Triple'];
    const last = world.graph.bonds[world.graph.bonds.length - 1];
    const what = last && last.type === 'covalent' ? `${kind[last.order]} bond · ` : '';
    hud.status(`${what}${info.formula} · ${free} open bond${free === 1 ? '' : 's'} left`);
    if (body.coTimer >= 0) {
      once('coHint', () => tell(LINES.coHint, {
        event: 'The player joined one carbon and one oxygen with a double bond.',
        facts: 'Carbon still has two open bonds. Adding a second oxygen makes carbon dioxide. Left alone instead, oxygen donates a lone pair to form a third bond, making carbon monoxide.',
      }));
    }
  },
  onDative(bond) {
    electrons.onDative(bond);
    sfx.snap(3);
    hud.status('Dative bond · oxygen donates a lone pair · C≡O');
  },
  onComplete(body, info) {
    state.slowMo = 0.7;
    state.shot = { t: 0, body };
    sfx.boom();
    const entry = info.entry;
    let fresh = false;
    if (entry) {
      const set = entry.bonus ? state.bonus : state.discovered;
      fresh = !set.has(entry.id);
      set.add(entry.id);
      const facts = plain(`Shape: ${entry.shape}. Bond angle: ${entry.angle}. ${entry.fact}`);
      if (fresh) {
        sfx.discover();
        if (entry.bonus) {
          hud.el.bonus.textContent = `+${state.bonus.size} bonus`;
          hud.setLast(`${entry.formula} · ${entry.name}`);
        } else hud.discovered(entry, state.discovered.size, state.bonus.size);
        const progress = entry.bonus ? 'It is a bonus structure outside the main list of 18.' : `Progress: ${state.discovered.size} of ${CORE_COUNT} catalogued.`;
        tell(entry.say, { event: `The player completed a molecule for the first time: ${entry.name}. ${progress}`, facts, priority: true, key: 'discovery' });
        if (!entry.bonus && state.discovered.size === CORE_COUNT) {
          tell(LINES.allFound, { event: 'The player has now found all 18 molecules in the catalogue. The collection is complete.', facts: '' });
        }
      } else {
        hud.setLast(`${entry.formula} · ${entry.name}`);
        aside(repeatLine(entry), 8, { event: `The player built ${entry.name} again. It was already catalogued.`, facts });
      }
      hud.banner(fresh ? (entry.bonus ? 'Bonus find!' : 'New molecule!') : 'Built again', entry.name, EMOJI[entry.id] || '✨', fresh);
      hud.status(`${entry.formula} · ${entry.shape} · ${entry.angle}`, 7);
    } else {
      hud.banner('Valid, but not in the catalogue', `Unnamed ${info.formula}`, '✨', false);
      hud.setLast(`${info.formula} · unnamed`);
      hud.status(`${info.formula} · every valence satisfied · not in the catalogue`, 7);
      aside(LINES.unnamed, 10, {
        event: `The player completed a structure that is not in the catalogue. Its formula is ${plain(info.formula)}.`,
        facts: 'Every atom in it has its valence satisfied, so the structure is allowed by the bonding rules. It simply has no entry in this lab’s catalogue.',
      });
    }
    world.after(0.55, () => {
      if (world.bodies.has(body.id)) card.show(cardInfo(body, info, fresh), body.id, 12);
    });
  },
  onReject(reason, res, va, vb) {
    hud.warn(`No bond · ${reason}`);
    sfx.reject();
    if (Math.random() < 0.6) {
      const full = res.atom ? world.graph.atom(res.atom) : null;
      const pool = res.code === 'metallic' ? LINES.rejected.metallic
        : res.code === 'ion' ? LINES.rejected.ion
          : full && full.el === 'H' && full.charge === 0 && Math.random() < 0.5 ? LINES.rejected.H : LINES.rejected.full;
      aside(pickLine(pool), 9, {
        event: `A bond was refused. The player pushed ${describeBody(world.bodyOf(va.id))} against ${describeBody(world.bodyOf(vb.id))}.`,
        facts: `${rejectionFact(res)} ${VALENCE_FACT}`,
      });
    }
  },
  onBreak(ids, body) {
    electrons.onBreak(ids);
    sfx.whoosh();
    if (card.bodyId === body.id) card.hide();
    hud.status(`Bonds broken · ${ids.length} free atoms · nothing lost`);
    const what = body.complete && body.info ? (body.info.entry ? body.info.name.toLowerCase() : 'an unnamed molecule') : 'an unfinished fragment';
    aside(pickLine(LINES.broken), 14, {
      event: `The player smashed ${what} back into ${ids.length} separate atoms.`,
      facts: 'Breaking bonds does not destroy atoms. Matter is conserved.',
    });
  },
  onClear(ids) {
    electrons.removeAtoms(ids);
    card.hide();
    hud.status('');
    sfx.whoosh();
  },
  onWarn(msg) {
    hud.warn(msg);
    sfx.reject();
  },
};

const world = new World({ stage, fx, strip, events });

const liquid = new LiquidLab({ stage, dock: liquidDock, fx, sfx, tell, aside: (canned, gap, opts) => aside(canned, gap, opts) });
const bubbles = new BubbleLab({ stage, fx, sfx, tell, aside: (canned, gap, opts) => aside(canned, gap, opts) });

// ------------------------------------------------------------------ modes / keys
function setQuality(key) {
  stage.setQuality(key);
  const q = QUALITY[key];
  dust.setCount(q.dust);
  particles.density = q.particleScale;
  electrons.trail = q.trail;
  uPointScale.value = stage.pointScale;
  strip.layout();
  liquidDock.layout();
}

function toggleQuality(auto = false) {
  setQuality(stage.qualityKey === 'high' ? 'low' : 'high');
  hud.status(`Quality: ${stage.quality.name.toLowerCase()}${auto ? ' (lowered automatically to keep things smooth)' : ''}`);
  sfx.blip(stage.qualityKey === 'high' ? 1400 : 800);
}

const MODE_NAMES = { build: 'the molecule bench', liquid: 'the liquid metal lab', bubbles: 'the bubble lab', water: 'the water lab' };

function setMode(mode) {
  if (!state.started || mode === state.mode) return;
  const from = state.mode;
  state.mode = mode;
  card.hide();
  hud.status('');
  if (from === 'liquid') liquid.exit();
  if (from === 'bubbles') bubbles.exit();
  if (mode === 'water') {
    if (!water) {
      water = new WaterSim({ count: 40 });
      waterView = new WaterView(water);
      waterView.eye = stage.eye;
    }
    water.setTemperature(state.temp);
    hud.status('Water lab · 40 × H₂O · temperature decides the phase');
    tell(state.cameraMode ? LINES.water.enter : LINES.water.enterMouse, {
      event: 'The player opened the water lab: forty water molecules in a box.',
      facts: 'Water is ice below 0 degrees Celsius, liquid up to 100, and steam above that. The dashed lines are hydrogen bonds between molecules.',
      must: state.cameraMode ? 'open both palms and move the hands apart to heat, together to cool' : 'scroll to change the temperature',
      priority: true,
      key: 'mode',
    });
    sfx.phase('LIQUID');
  } else if (mode === 'liquid') {
    liquid.enter();
    tell(state.cameraMode ? LINES.liquid.enter : LINES.liquid.enterMouse, {
      event: `The player opened the liquid metal lab. A blob of ${liquid.material.name.toLowerCase()} just poured in.`,
      facts: liquid.material.fact,
      must: state.cameraMode ? 'pinch the liquid and pull to tear off droplets, and pick other liquids from the dock' : 'drag the liquid to pull droplets off, and pick other liquids from the dock',
      priority: true,
      key: 'mode',
    });
  } else if (mode === 'bubbles') {
    bubbles.enter();
    sfx.blow(0.5);
    tell(state.cameraMode ? LINES.bubbles.enter : LINES.bubbles.enterMouse, {
      event: 'The player opened the bubble lab, full of soap bubbles.',
      facts: BUBBLE_FACTS.colours,
      must: state.cameraMode ? 'pinch and hold to blow a bubble, open the fingers to let it go' : 'hold the mouse button to blow a bubble, release to let it go',
      priority: true,
      key: 'mode',
    });
  } else {
    tell(LINES.back, { event: `The player left ${MODE_NAMES[from]} and returned to the molecule bench.`, facts: '', priority: true, key: 'mode' });
    sfx.blip(900);
  }
  hud.setMode(mode);
}

function toggleMute() {
  const muted = narrator.toggleMute();
  sfx.setMuted(muted);
  hud.setMute(muted);
}

const keyActions = {
  q: () => toggleQuality(),
  a: () => setMode('build'),
  l: () => setMode('liquid'),
  b: () => setMode('bubbles'),
  w: () => setMode('water'),
  m: () => toggleMute(),
  c: () => {
    if (state.mode === 'liquid') liquid.refill();
    if (state.mode === 'bubbles') bubbles.popAll();
    if (state.mode === 'build' && world.atomCount) {
      world.clear();
      aside(LINES.cleared, 8, { event: 'The player wiped the whole bench clean.', facts: '' });
    }
  },
  h: () => hud.toggleHelp(),
};

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const k = e.key.toLowerCase();
  if (keyActions[k]) keyActions[k]();
  // number keys spawn an element at the cursor: handy with a trackpad
  const idx = '123456'.indexOf(k);
  if (idx >= 0 && state.started && state.mode === 'build') {
    const sym = ['H', 'C', 'N', 'O', 'Na', 'Cl'][idx];
    world.spawn(sym, mouse.active ? mouse.pos : new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2, 0));
  }
  if (idx >= 0 && idx < MATERIALS.length && state.started && state.mode === 'liquid') liquid.setMaterial(MATERIALS[idx].id);
});
document.querySelectorAll('#keys button').forEach((btn) => {
  btn.addEventListener('click', () => {
    keyActions[btn.dataset.key]?.();
    btn.blur();
  });
});
document.querySelectorAll('#modes button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setMode(btn.dataset.mode);
    btn.blur();
  });
});
hud.onMaterial = (id) => liquid.setMaterial(id);
window.addEventListener('resize', () => {
  stage.resize();
  uPointScale.value = stage.pointScale;
  strip.layout();
  liquidDock.layout();
});

// ------------------------------------------------------------------ boot
async function start(useCamera) {
  const btnStart = document.getElementById('btn-start');
  const btnMouse = document.getElementById('btn-mouse');
  btnStart.disabled = true;
  btnMouse.disabled = true;
  sfx.init();
  sfx.resume();
  hud.bootLog('Sound ready');
  let cameraOk = false;
  if (useCamera) {
    try {
      hud.bootLog('Asking for the camera…');
      await tracker.startCamera();
      stage.setVideo(video);
      hud.bootLog(`Camera ready · ${video.videoWidth}×${video.videoHeight}`);
      hud.bootLog('Loading hand and face tracking…');
      await tracker.loadModels(() => {});
      hud.bootLog('Tracking ready');
      cameraOk = true;
    } catch (err) {
      console.warn('[boot] camera / tracking unavailable, using mouse mode:', err);
      hud.bootLog(`No camera (${err.name || 'error'}), using the mouse instead`);
    }
  } else hud.bootLog('Mouse mode');
  state.cameraMode = cameraOk;
  hud.bootLog('Here we go');
  await new Promise((r) => setTimeout(r, 450));
  hud.bootDone();
  hud.show();
  state.started = true;
  const hour = new Date().getHours();
  const part = hour < 5 ? 'the middle of the night' : hour < 12 ? 'the morning' : hour < 18 ? 'the afternoon' : 'the evening';
  tell(cameraOk ? greeting() : `${greeting()} ${LINES.mouseMode}`, {
    event: `A player has just arrived and switched the lab on, in ${part}. Greet them. Input: ${cameraOk ? 'hand tracking through the webcam' : 'mouse only, no camera'}.`,
    facts: '',
    must: cameraOk ? 'pinch an element from the shelf at the top and pull it into the room to begin' : 'click and drag an element from the shelf at the top to begin',
    priority: true,
    reset: true, // new session: the companion forgets earlier conversations
  });
}

document.getElementById('btn-start').addEventListener('click', () => start(true));
document.getElementById('btn-mouse').addEventListener('click', () => start(false));
hud.bootLog('Runs entirely on this Mac');
narrator.watchServer();

// ------------------------------------------------------------------ frame pieces
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();

function updateHead(dt, t) {
  // face → head position (mirrored window coords) + reticle
  const f = state.face;
  if (tracker.faceStamp !== f.stamp) {
    const ft = t - f.t;
    f.stamp = tracker.faceStamp;
    f.t = t;
    const lm = tracker.face;
    if (lm) {
      const cover = stage.cover;
      const mid = lm[168]; // between the eyes
      const fdt = f.on ? ft : 0;
      f.x = state.headFilter[0].filter(((1 - mid.x - 0.5) / cover.x) * 2, fdt);
      f.y = state.headFilter[1].filter((-(mid.y - 0.5) / cover.y) * 2, fdt);
      const iod = Math.hypot((lm[33].x - lm[263].x) * stage.videoAspect, lm[33].y - lm[263].y); // outer eye corners, image heights
      f.size = state.headFilter[2].filter(iod, fdt);
      f.noseY = (-(lm[1].y - 0.5) / cover.y) * 2;
      f.lastSeen = t;
      f.on = true;
    }
  }
  if (f.on && t - f.lastSeen > 0.6) {
    f.on = false;
    for (const flt of state.headFilter) flt.reset();
  }

  // target eye offset: face position, or arrow keys, plus a slow idle sway
  let hx = mouse.head.x;
  let hy = mouse.head.y * 0.7;
  if (f.on) {
    hx += clamp(f.x * 1.25, -1.2, 1.2);
    hy += clamp((f.y - 0.15) * 1.0, -1, 1);
  }
  hx += Math.sin(t * 0.21) * 0.07;
  hy += Math.sin(t * 0.17 + 1.3) * 0.05;
  const k = damp(f.on ? 7 : 4, dt);
  state.head.x += (hx - state.head.x) * k;
  state.head.y += (hy - state.head.y) * k;
  stage.eye.x = state.head.x * 1.7;
  stage.eye.y = state.head.y * 1.0;

  if (f.on && state.started) {
    stage.windowToScreen(f.x, f.noseY ?? f.y, _v);
    const px = (_v.x * 0.5 + 0.5) * stage.width;
    const py = (1 - (_v.y * 0.5 + 0.5)) * stage.height;
    // head height on screen: about twice the distance between the outer eye corners
    const size = (f.size / stage.cover.y) * stage.height * 2.1;
    // a name tag floats above the head and levels up with the collection
    // (above the head when there is room under the dock, otherwise over the shoulder)
    const above = py - size * 0.95 > 185;
    hud.badge(true, above ? px : px + size * 0.95, above ? py - size * 0.95 : py + size * 0.6, `${rankFor(state.discovered.size)} · ${state.discovered.size}/${CORE_COUNT}`);
  } else hud.badge(false);
}

function updateCameraShot(dt) {
  // slow motion (real-time clock)
  if (state.slowMo > 0) {
    state.slowMo -= dt;
    state.timeScale += (0.2 - state.timeScale) * damp(18, dt);
  } else state.timeScale += (1 - state.timeScale) * damp(3.2, dt);

  // push-in on the finished molecule: in 0.5 s, hold, ease back
  let zoom = 1;
  let fx0 = 0;
  let fy0 = 0;
  const shot = state.shot;
  if (shot) {
    shot.t += dt;
    const inT = 0.5, hold = 1.5, outT = 1.2;
    let k;
    if (shot.t < inT) k = easeInOut(shot.t / inT);
    else if (shot.t < inT + hold) k = 1;
    else k = 1 - easeInOut((shot.t - inT - hold) / outT);
    if (shot.t > inT + hold + outT) state.shot = null;
    zoom = 1 - 0.13 * k;
    if (world.bodies.has(shot.body.id)) {
      fx0 = shot.body.pos.x * 0.34 * k;
      fy0 = shot.body.pos.y * 0.34 * k;
    }
  }
  stage.zoom = zoom;
  stage.focus.set(fx0, fy0);
}

function updateTemperature(dt) {
  const tg = gestures.temp;
  state.tempLive = tg.active;
  if (state.mode === 'liquid' || state.mode === 'bubbles') state.tempLive = false;
  else if (tg.active) {
    const target = TEMP.min + tg.value * (TEMP.max - TEMP.min);
    state.temp += (target - state.temp) * damp(5, dt);
  }
  const wheel = mouse.takeWheel();
  if (wheel && (state.mode === 'build' || state.mode === 'water')) state.temp = clamp(state.temp + wheel * 0.07, TEMP.min, TEMP.max);
  world.temp = state.temp;
  world.tempGesture = tg.active;
  const heat = clamp((state.temp - TEMP.min) / (TEMP.max - TEMP.min), 0, 1);
  dust.uniforms.uEnergy.value = heat;
  electrons.speed = 0.7 + heat * 0.9;
}

function drawTempLink(alpha) {
  const tg = gestures.temp;
  if (!tg.active || !state.tempLive) return;
  const [A, B] = gestures.hands;
  const heat = clamp((state.temp - TEMP.min) / (TEMP.max - TEMP.min), 0, 1);
  const col = heat < 0.27 ? COL.water : heat > 0.73 ? COL.hot : COL.accent;
  beams.add(A.palm, B.palm, col, col, 0.016, 0.9 * alpha, BEAM.ENERGY, 5);
  // the hotter it gets, the more the link between the palms wobbles
  fx.drawBolt(A.palm, B.palm, col, 0.008, 0.6 * alpha, 91, 0.04 + heat * 0.3, 16);
  _v.copy(tg.mid);
  _v.y += 0.45;
  text.draw(`${state.temp.toFixed(0)} °C`, _v, 0.34, COL.white, alpha);
}

function drawPointerAids() {
  // 3D cursor for the mouse fallback (shows depth), hover rings for every pointer
  if (mouse.active && gestures.count === 0 && state.started) {
    glow.add(mouse.pos, 0.22 - mouse.charge * 0.07, COL.white, mouse.pinch ? 1 : 0.8, BB.RING, 0.82, mouse.pinch ? 0.09 : 0.05);
    if (Math.abs(mouse.z) > 0.05) {
      _v.copy(mouse.pos);
      _v.y -= 0.42;
      text.draw(`Z ${mouse.z >= 0 ? '+' : '−'}${Math.abs(mouse.z).toFixed(1)}`, _v, 0.13, COL.accent, 0.85);
    }
  }
  if (state.mode !== 'build') return;
  for (const p of pointers) {
    if (!p.active || p.held || !p.hover) continue;
    const body = p.hover.body;
    glow.add(body.pos, body.radius + 0.3, COL.accent, 0.28, BB.RING, 0.92, 0.007);
  }
}

function updateWater(dt, t, mix) {
  if (!water) return;
  const active = state.mode === 'water';
  if (active) {
    water.setTemperature(state.temp);
    const changed = water.step(dt);
    if (changed) onPhaseChange(changed);
    // any pinch-drag (or mouse drag) turns the chamber
    for (const p of pointers) {
      if (!p.active) continue;
      if (p.pinch && p._wx !== undefined) waterView.rotate((p.nx - p._wx) * 2.2, -(p.ny - p._wy) * 1.4);
      p._wx = p.pinch ? p.nx : undefined;
      p._wy = p.ny;
      if (p.rotate) waterView.rotate(p.rotate.dx * 0.008, p.rotate.dy * 0.008);
    }
    // ambient phase particles
    if (Math.random() < dt * 22) {
      const i = Math.floor(Math.random() * water.n);
      waterView.moleculeWorld(i, _v);
      if (water.phase === 'GAS') particles.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), 0, 1.4, 0, COL.hot, 0.03);
      else if (water.phase === 'ICE') particles.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.5, -0.5 * Math.random(), (Math.random() - 0.5) * 0.5, 1.8, 0, COL.ice, 0.028);
    }
  }
  waterView.update(dt, t);
  waterView.draw(batches, t, mix);
}

function onPhaseChange({ from, to }) {
  sfx.phase(to);
  waterView.pulse = 1;
  fx.flash = Math.max(fx.flash, 0.3);
  fx.shockwave(waterView.centre);
  fx.ring(waterView.centre, 9, waterView.color, 1.2);
  const line = to === 'ICE' ? LINES.water.freeze : to === 'GAS' ? LINES.water.boil : from === 'ICE' ? LINES.water.melt : LINES.water.condense;
  const label = to === 'ICE' ? 'Freezing' : to === 'GAS' ? 'Boiling' : from === 'ICE' ? 'Melting' : 'Condensing';
  const phaseEmoji = to === 'ICE' ? '🧊' : to === 'GAS' ? '♨️' : '💧';
  tell(line, {
    event: `Phase transition in the water chamber: ${label.toLowerCase()} (${from.toLowerCase()} to ${to.toLowerCase()}) at ${state.temp.toFixed(0)} degrees Celsius.`,
    facts: line,
    priority: true,
    key: 'phase',
  });
  hud.banner(`Phase change · ${from.toLowerCase()} → ${to.toLowerCase()}`, label, phaseEmoji, false);
  const burstCol = to === 'ICE' ? COL.ice : to === 'GAS' ? COL.hot : COL.water;
  for (let i = 0; i < water.n; i += 2) {
    waterView.moleculeWorld(i, _v);
    fx.burst(_v, 5, burstCol, 1.2, 0.045, 0.8);
  }
}

// ------------------------------------------------------------------ coach: what to do next
// Easy-to-hard order in which molecules are suggested.
const SUGGEST = ['H2', 'H2O', 'O2', 'CH4', 'NH3', 'CO2', 'HCl', 'NaCl', 'N2', 'Cl2', 'HCN', 'NaOH', 'H2O2', 'CO', 'C2H2', 'C2H4', 'C2H6', 'CH3OH'];

function nextTarget() {
  const id = SUGGEST.find((x) => !state.discovered.has(x));
  return id ? CATALOG.find((e) => e.id === id) : null;
}

function coachLine() {
  const cam = state.cameraMode;
  if (state.mode === 'liquid') return liquid.coach(cam);
  if (state.mode === 'bubbles') return bubbles.coach(cam);
  if (state.mode === 'water') {
    return cam
      ? 'Open both palms: hands apart = hotter, together = colder. Pinch-drag turns the chamber.'
      : 'Scroll = temperature: ice below 0 °C, steam above 100 °C. Drag turns the chamber.';
  }
  const grab = cam ? 'Pinch' : 'Click and drag';
  const bodies = [...world.bodies.values()];
  if (!bodies.length) return `${grab} an element on the shelf above and pull it down into the room.`;
  const held = pointers.find((p) => p.held)?.held;
  if (held) {
    if (world.previews.some((p) => p.ok)) return 'Green dashes: these two will bond. Push them together.';
    if (world.previews.length) return 'Red dashes: no bond possible. That atom has no open slot left.';
    if (bodies.length === 1) return 'Let go to leave it floating, then fetch a second element.';
    return `Touch it against another atom. They bond wherever both have an open slot (the small stubs).${cam ? '' : ' Shift + wheel moves it in depth.'}`;
  }
  const fragment = bodies.find((b) => b.atoms.length > 1 && !b.complete);
  if (fragment) {
    if (fragment.coTimer >= 0) return 'C=O: add another O for carbon dioxide, or leave it alone and watch it become carbon monoxide.';
    let free = 0;
    for (const id of fragment.atoms) free += world.graph.freeValence(id);
    return `${fragment.info.formula} still has ${free} open slot${free === 1 ? '' : 's'}. Keep adding atoms until none are left.`;
  }
  if (bodies.every((b) => b.atoms.length === 1)) {
    return bodies.length === 1 ? `Now fetch a second element and bring the two together.` : `${cam ? 'Pinch' : 'Drag'} one atom onto another to bond them.`;
  }
  const next = nextTarget();
  const undo = cam ? 'Open-palm swipe breaks a molecule.' : 'Double-click breaks a molecule.';
  return next ? `Next: ${next.name} = ${next.recipe}. ${undo} C clears the bench.` : `All 18 found. Build anything with no open slots left. ${undo}`;
}

let coachClock = 1;
function updateCoach(dt) {
  coachClock += dt;
  if (coachClock < 0.25 || !state.started) return;
  coachClock = 0;
  hud.coach(coachLine());
  hud.setNext(nextTarget());
  if (state.mode === 'liquid') hud.liquid(liquid.panel());
  if (state.mode === 'bubbles') hud.bubbles(bubbles.panel());
}

// ------------------------------------------------------------------ hold V: ask a question out loud
const talk = { active: false, stream: null, rec: null, chunks: [] };

async function startTalk() {
  if (talk.active || !state.started) return;
  if (!narrator.server.ok || !narrator.server.ears) {
    hud.warn('Voice companion is off. Start it with: npm run voice');
    return;
  }
  talk.active = true;
  narrator.stop();
  hud.setAsk(true, true);
  hud.status('Listening… ask your question, then release V', 30);
  try {
    talk.stream ||= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    talk.active = false;
    hud.setAsk(true, false);
    hud.warn('Microphone unavailable');
    return;
  }
  if (!talk.active) return; // key was released while the permission prompt was open
  talk.chunks = [];
  const rec = new MediaRecorder(talk.stream);
  talk.rec = rec;
  rec.ondataavailable = (e) => e.data.size && talk.chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(talk.chunks, { type: rec.mimeType });
    if (blob.size < 3000) return hud.status('Too short. Hold V while you speak.', 4);
    hud.status('Question sent…', 20);
    narrator.ask(blob, { state: labState(), reference: REFERENCE });
  };
  rec.start();
}

function stopTalk() {
  if (!talk.active) return;
  talk.active = false;
  hud.setAsk(true, false);
  if (talk.rec && talk.rec.state === 'recording') talk.rec.stop();
  else hud.status('');
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'v' && !e.repeat && !e.metaKey && !e.ctrlKey) startTalk();
});
window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'v') stopTalk();
});
const askBtn = document.getElementById('k-ask');
askBtn.addEventListener('pointerdown', startTalk);
askBtn.addEventListener('pointerup', stopTalk);
askBtn.addEventListener('pointerleave', stopTalk);

// ------------------------------------------------------------------ hands on glass buttons
// A tracked hand can use every DOM button: hovering highlights it, a pinch presses it.
const pressed = new Map(); // hand -> button it is pressing
function buttonUnder(p) {
  stage.windowToScreen(p.nx, p.ny, _v);
  const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (0.5 - _v.y * 0.5) * window.innerHeight;
  const el = document.elementFromPoint(x, y);
  const btn = el && el.closest ? el.closest('#hud button') : null;
  return btn && !btn.disabled && btn.offsetParent ? btn : null;
}
function pressButtons() {
  for (const el of document.querySelectorAll('#hud button.hand-hover')) el.classList.remove('hand-hover');
  for (const p of gestures.hands) {
    if (!p.active) continue;
    const btn = !p.held ? buttonUnder(p) : null;
    if (btn) btn.classList.add('hand-hover');
    if (p.pinchDown && btn) {
      p.pinchDown = false; // the scene does not get this pinch
      btn.classList.add('hand-press');
      pressed.set(p, btn);
      if (btn.id === 'k-ask') startTalk();
      else btn.click();
    }
    const held = pressed.get(p);
    if (held && !p.pinch) {
      held.classList.remove('hand-press');
      if (held.id === 'k-ask') stopTalk();
      pressed.delete(p);
    }
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let lastHandsStamp = -1;

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
  last = now;
  state.realTime += realDt;
  const t = state.realTime;
  state.fps += (1 / realDt - state.fps) * 0.06;

  // ---- input
  tracker.update(now);
  if (tracker.handsStamp !== lastHandsStamp) {
    lastHandsStamp = tracker.handsStamp;
    gestures.ingest(tracker.hands, t);
  }
  updateCameraShot(realDt);
  updateHead(realDt, t);
  stage.updateCamera(); // pointers are lifted into the world with this frame's camera
  gestures.update(realDt, t);
  mouse.update(realDt);
  updateTemperature(realDt);

  const dt = realDt * state.timeScale;
  state.simTime += dt;
  uTime.value = state.simTime;
  const st = state.simTime;

  // ---- simulate + draw into the immediate-mode batches
  atoms.begin();
  tubes.begin();
  rings.begin();
  beams.begin();
  glow.begin();
  labels.begin();
  points.begin();
  text.begin();

  const mixTarget = state.mode === 'water' ? 1 : 0;
  state.waterMix += (mixTarget - state.waterMix) * damp(4, realDt);
  const mix = state.waterMix;
  state.buildMix += ((state.mode === 'build' ? 1 : 0) - state.buildMix) * damp(4, realDt);
  const buildAlpha = clamp(state.buildMix * 1.6 - 0.6, 0, 1);

  if (state.started) {
    pressButtons(); // a pinch on a glass button is a click
    world.update(dt, st, pointers, state.mode === 'build');
    world.draw(batches, st, buildAlpha);
    electrons.update(dt);
    if (buildAlpha > 0.02) electrons.draw(world, st, buildAlpha);
    strip.draw(batches, pointers, st, realDt, state.mode === 'build');
    liquidDock.draw(batches, pointers, st, realDt, state.mode === 'liquid');
    liquid.update(dt, st, pointers, state.mode === 'liquid');
    bubbles.update(dt, st, pointers, state.mode === 'bubbles');
    if (mix > 0.01) updateWater(dt, st, clamp(mix * 1.6 - 0.6, 0, 1));

    for (const h of gestures.hands) drawHand(h, fx, st);
    drawTempLink(1);
    drawPointerAids();

    // sound that follows continuous input
    let holding = 0;
    let lift = 0.5;
    let charge = 0;
    for (const p of pointers) {
      if (p.held) {
        holding = 1;
        lift = clamp((p.held.pos.z + 3) / 6.5, 0, 1);
      } else if (p.active && p.kind === 'hand' && !p.pinch) charge = Math.max(charge, p.charge);
    }
    if (state.mode === 'liquid') holding = Math.max(holding, liquid.grips.size ? 0.7 : 0, liquid.magnet.amount);
    sfx.setHum(holding, lift);
    sfx.setCharge(charge);

    // info card + tether to its molecule
    const cb = card.bodyId !== null ? world.bodies.get(card.bodyId) : null;
    if (card.active && !cb) card.hide();
    card.update(realDt, st, cb ? cb.pos : null, cb ? cb.radius : 0, stage);
    if (card.active && cb && buildAlpha > 0.5) {
      const a = card.opacity;
      _n.subVectors(card.anchor, cb.pos).normalize();
      _w.copy(cb.pos).addScaledVector(_n, cb.radius + 0.25);
      beams.add(_w, card.anchor, COL.accent, COL.accent, 0.007, 0.5 * a, BEAM.SOLID);
      glow.add(_w, 0.05, COL.white, a, BB.NODE);
      glow.add(card.anchor, 0.05, COL.white, a, BB.NODE);
    }
    if (buildAlpha <= 0.05) card.panel.alpha = 0;
  }

  fx.update(dt, st);

  // scene tint: neutral on the bench, phase-coloured in the chamber
  const tintTarget = water && mix > 0.3 ? PHASE_TINT[water.phase] : [1, 1, 1];
  const tk = damp(1.4, realDt);
  for (let i = 0; i < 3; i++) state.tint[i] += (tintTarget[i] - state.tint[i]) * tk;
  stage.final.uniforms.uTint.value = state.tint;
  const gc = grid.uniforms.uColor.value;
  const gridCol = water && mix > 0.3 ? waterView.color : COL.accent;
  gc.set(gc.x + (gridCol[0] - gc.x) * tk, gc.y + (gridCol[1] - gc.y) * tk, gc.z + (gridCol[2] - gc.z) * tk);
  dust.uniforms.uColor.value.copy(gc).lerp(_v.set(1, 1, 1), 0.5);

  atoms.end();
  tubes.end();
  rings.end();
  beams.end();
  glow.end();
  labels.end();
  points.end();
  text.end();
  particles.flush();
  stage.dimTarget = !state.started ? 0.34 : state.mode === 'liquid' ? 0.5 : 0.6;
  stage.render(st, realDt);

  // ---- HUD
  updateCoach(realDt);
  const sv = narrator.server;
  hud.update(realDt, {
    temp: state.temp,
    tempLive: state.tempLive,
    fps: state.fps,
    quality: stage.quality.name,
    hands: state.cameraMode
      ? `${gestures.count} hand${gestures.count === 1 ? '' : 's'}${state.face.on ? ' · head' : ''}`
      : 'Mouse',
    tracking: !state.cameraMode || gestures.count > 0,
    voice: narrator.muted ? 'Muted' : sv.ok ? `${sv.persona}${sv.llm ? ' · live' : ''}` : 'Browser voice',
    phase: state.mode === 'water' && water ? water.phase : '',
  });

  // ---- automatic quality drop if the frame rate is not holding
  if (state.started && !state.autoDropped && stage.qualityKey === 'high' && t > 8) {
    state.lowFpsTime = state.fps < 27 ? state.lowFpsTime + realDt : 0;
    if (state.lowFpsTime > 4) {
      state.autoDropped = true;
      toggleQuality(true);
    }
  }
}

setQuality('high');
requestAnimationFrame(frame);

// Debug / test handle (used by the README's console tips and automated smoke tests).
window.__lab = { stage, world, strip, state, labState, ask: (q) => narrator.ask(q, { state: labState(), reference: REFERENCE }), gestures, mouse, tracker, hud, narrator, sfx, fx, card, electrons, get water() { return water; }, toggleWater: () => setMode(state.mode === 'water' ? 'build' : 'water'), toggleQuality, setMode, liquid, bubbles, liquidDock };
