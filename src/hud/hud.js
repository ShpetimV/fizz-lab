import { CATALOG, CORE_COUNT } from '../chemistry/index.js';
import { TEMP } from '../config.js';
import { clamp } from '../core/math.js';
import { flairColor, flairInk } from './flair.js';
import { MATERIALS } from '../liquid/materials.js';
import { drawFilmChart } from '../bubbles/lab.js';

const PHASE_LABEL = { ICE: 'Ice 🧊', LIQUID: 'Water 💧', GAS: 'Steam ♨️' };

const $ = (id) => document.getElementById(id);

/** DOM interface: glass panels, temperature slider, head badge, toasts, captions, coach line, welcome card. */
export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), fps: $('o-fps'), quality: $('o-quality'), hands: $('o-hands'), voice: $('o-voice'),
      count: $('o-count'), bonus: $('o-bonus'), last: $('o-last'), grid: $('o-grid'), bar: $('o-bar'), dot: $('d-hands'),
      next: $('o-next'), nextName: $('o-next-name'), nextRecipe: $('o-next-recipe'),
      gauge: $('gauge'), gFill: $('g-fill'), gMarker: $('g-marker'), gValue: $('g-value'), gPhase: $('g-phase'),
      warn: $('warn'), warnText: $('warn-text'), banner: $('banner'), bannerTop: $('banner-top'), bannerText: $('banner-text'),
      bannerEmoji: $('banner-emoji'), aura: $('aura'),
      subtitle: $('subtitle'), subName: $('sub-name'), subText: $('sub-text'), help: $('help'), mute: $('k-mute'),
      coach: $('coach'), coachText: $('coach-text'), ask: $('k-ask'),
      badge: $('badge'), badgeText: $('r-text'), boot: $('boot'), bootLog: $('boot-log'),
      lab: $('p-lab'), liquid: $('p-liquid'), bubbles: $('p-bubbles'), clear: $('k-clear'),
      lDrops: $('l-drops'), lSwatch: $('l-swatch'), lName: $('l-name'), lSub: $('l-sub'), lTemp: $('l-temp'), lChips: $('l-chips'), lFact: $('l-fact'),
      bAlive: $('b-alive'), bPopped: $('b-popped'), bChart: $('b-chart'), bMarks: $('b-marks'),
    };
    this.cells = new Map();
    for (const entry of CATALOG.filter((e) => !e.bonus)) {
      const cell = document.createElement('div');
      cell.textContent = entry.formula;
      cell.style.setProperty('--chip', flairColor(CATALOG.indexOf(entry)));
      cell.style.setProperty('--chip-ink', flairInk(CATALOG.indexOf(entry)));
      this.el.grid.appendChild(cell);
      this.cells.set(entry.id, cell);
    }
    this.onMaterial = () => {};
    for (const m of MATERIALS) {
      const b = document.createElement('button');
      b.className = m.id;
      b.dataset.material = m.id;
      b.innerHTML = `<i></i>${m.short || m.name}`;
      b.addEventListener('click', () => {
        this.onMaterial(m.id);
        b.blur();
      });
      this.el.lChips.appendChild(b);
    }
    drawFilmChart(this.el.bChart, 1000);
    this.mode = 'build';
    this.sub = { text: '', shown: 0, hold: 0, active: false };
    this.slow = 0;
    this.coachText = '';
    this.event = { text: '', until: 0 };
    this.clock = 0;
    this.bootLines = [];
    this.nextId = null;
  }

  show() {
    this.el.hud.classList.remove('hidden');
  }

  // ---- boot screen ----
  bootLog(line) {
    this.bootLines.push(line);
    this.el.bootLog.textContent = line;
  }

  bootDone() {
    this.el.boot.classList.add('gone');
  }

  // ---- event-driven pieces ----
  warn(text) {
    const w = this.el.warn;
    this.el.warnText.textContent = text;
    w.classList.remove('on');
    void w.offsetWidth; // restart the CSS animation
    w.classList.add('on');
  }

  /** Toast at the top of the room. `party` adds the rainbow rim for a first-time discovery. */
  banner(top, text, emoji = '✨', party = false) {
    const b = this.el.banner;
    this.el.bannerTop.textContent = top;
    this.el.bannerText.textContent = text;
    this.el.bannerEmoji.textContent = emoji;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    if (party) {
      this.el.aura.classList.remove('on');
      void this.el.aura.offsetWidth;
      this.el.aura.classList.add('on');
    }
  }

  /** What to do next. Always visible; briefly replaced by event messages. */
  coach(text) {
    this.coachText = text;
  }

  /** Short-lived message about what just happened (takes over the coach line for a few seconds). */
  status(text, seconds = 4.5) {
    this.event = { text, until: text ? this.clock + seconds : 0 };
  }

  subtitle(text, append = false) {
    const keep = append && this.sub.active ? this.sub.shown : 0;
    this.sub = { text, shown: keep, hold: 0, active: true };
    if (!append) this.el.subText.textContent = '';
    this.el.subtitle.classList.remove('thinking');
    this.el.subtitle.classList.add('on');
  }

  subtitleEnd() {
    this.sub.hold = 1.4; // linger briefly after speech ends
  }

  thinking(on) {
    const s = this.el.subtitle;
    if (on && !this.sub.active) {
      this.el.subText.textContent = '';
      s.classList.add('on', 'thinking');
    } else if (!on) {
      s.classList.remove('thinking');
      if (!this.sub.active) s.classList.remove('on');
    }
  }

  setPersona(name) {
    this.el.subName.textContent = name;
  }

  discovered(entry, count, bonus) {
    this.el.count.textContent = String(count);
    this.el.bonus.textContent = bonus ? `+${bonus} bonus` : '';
    this.el.last.textContent = `${entry.formula} · ${entry.name}`;
    this.el.bar.style.width = `${(count / CORE_COUNT) * 100}%`;
    const big = this.el.count.parentElement;
    big.classList.remove('pulse');
    void big.offsetWidth;
    big.classList.add('pulse');
    this.cells.get(entry.id)?.classList.add('on');
  }

  /** Suggest the next undiscovered molecule and how to build it. */
  setNext(entry) {
    const id = entry ? entry.id : null;
    if (id === this.nextId) return;
    this.nextId = id;
    for (const cell of this.cells.values()) cell.classList.remove('next');
    if (entry) {
      this.el.nextName.textContent = `${entry.name} ${entry.formula}`;
      this.el.nextRecipe.textContent = entry.recipe;
      this.cells.get(entry.id)?.classList.add('next');
    } else {
      this.el.nextName.textContent = 'All 18 found 🎉';
      this.el.nextRecipe.textContent = 'Invent something: any structure with no open bonds is valid.';
    }
    this.el.next.classList.toggle('done', !entry);
  }

  setLast(text) {
    this.el.last.textContent = text;
  }

  setMute(muted) {
    this.el.mute.textContent = muted ? 'off' : 'on';
  }

  setAsk(available, recording = false) {
    this.el.ask.classList.toggle('hide', !available);
    this.el.ask.classList.toggle('rec', recording);
  }

  toggleHelp() {
    this.el.help.classList.toggle('off');
  }

  /** 'build' | 'liquid' | 'bubbles' | 'water': highlights the mode and swaps the panels that belong to it. */
  setMode(mode) {
    this.mode = mode;
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('active', b.dataset.mode === mode);
    this.el.lab.classList.toggle('off', mode !== 'build');
    this.el.liquid.classList.toggle('off', mode !== 'liquid');
    this.el.bubbles.classList.toggle('off', mode !== 'bubbles');
    this.el.gauge.classList.toggle('off', mode === 'liquid' || mode === 'bubbles');
    this.el.clear.textContent = { build: 'Clear', liquid: 'Refill', bubbles: 'Pop all', water: 'Clear' }[mode];
    if (mode !== 'build') this.badge(false);
  }

  /** Liquid panel. `v` from LiquidLab.panel(). */
  liquid(v) {
    const e = this.el;
    e.lDrops.textContent = `${v.droplets} droplet${v.droplets === 1 ? '' : 's'}`;
    if (v.id === this._material) return;
    this._material = v.id;
    e.lSwatch.className = `m-swatch ${v.id}`;
    e.lName.textContent = v.name;
    e.lSub.textContent = v.sub;
    e.lTemp.textContent = v.temp;
    e.lFact.textContent = v.fact;
    for (const b of e.lChips.children) b.classList.toggle('on', b.dataset.material === v.id);
  }

  /** Bubble panel. `v` from BubbleLab.panel(). */
  bubbles(v) {
    const e = this.el;
    e.bPopped.textContent = String(v.popped);
    e.bAlive.textContent = `${v.alive} floating`;
    const marks = e.bMarks;
    while (marks.children.length < v.films.length) marks.appendChild(document.createElement('i'));
    while (marks.children.length > v.films.length) marks.lastChild.remove();
    v.films.forEach((nm, i) => {
      marks.children[i].style.left = `${Math.min(100, (nm / 1000) * 100).toFixed(1)}%`;
    });
  }

  /** Name tag that floats above the tracked head. x, y in CSS pixels (bottom centre of the tag). */
  badge(on, x = 0, y = 0, text = '') {
    const b = this.el.badge;
    on = on && this.mode === 'build';
    b.classList.toggle('on', on);
    if (!on) return;
    b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (text !== this._badge) {
      this._badge = text;
      this.el.badgeText.textContent = text;
    }
  }

  // ---- per-frame ----
  update(dt, s) {
    this.clock += dt;
    // typewriter subtitle
    const sub = this.sub;
    if (sub.active) {
      if (sub.shown < sub.text.length) {
        sub.shown = Math.min(sub.text.length, sub.shown + dt * 60);
        this.el.subText.textContent = sub.text.slice(0, Math.floor(sub.shown));
      }
      if (sub.hold > 0) {
        sub.hold -= dt;
        if (sub.hold <= 0) {
          sub.active = false;
          this.el.subtitle.classList.remove('on');
        }
      }
    }

    // gauge follows temperature every frame (it is the feedback for a gesture)
    const f = clamp((s.temp - TEMP.min) / (TEMP.max - TEMP.min), 0, 1) * 100;
    this.el.gFill.style.height = `${f.toFixed(1)}%`;
    this.el.gMarker.style.bottom = `max(${f.toFixed(1)}%, 36px)`;

    // everything else at ~8 Hz
    this.slow += dt;
    if (this.slow < 0.12) return;
    this.slow = 0;
    const e = this.el;
    e.fps.textContent = s.fps.toFixed(0);
    e.quality.textContent = s.quality === 'LOW' ? '· low' : '';
    e.hands.textContent = s.hands;
    e.dot.classList.toggle('ok', !!s.tracking);
    e.voice.textContent = s.voice;
    e.gValue.textContent = `${s.temp.toFixed(0)}°`;
    e.gPhase.textContent = PHASE_LABEL[s.phase] || '';
    e.gauge.classList.toggle('live', s.tempLive);
    e.gauge.classList.toggle('idle', !s.phase && !s.tempLive);
    e.gFill.style.setProperty('--gc', s.temp < 0 ? '#d4ebff' : s.temp > 100 ? '#ff9f0a' : '#64d2ff');

    const showEvent = this.event.text && this.clock < this.event.until;
    const line = showEvent ? this.event.text : this.coachText;
    if (line !== this._line) {
      this._line = line;
      e.coachText.textContent = line;
    }
    e.coach.classList.toggle('event', !!showEvent);
  }
}

export { CORE_COUNT };
