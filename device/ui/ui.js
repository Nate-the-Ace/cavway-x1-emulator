// The X1's front panel as a state machine: five buttons in, a scene out.
import { scene } from './scene.js';
import { defaultUiSettings } from './settings.js';
import { Instrument } from '../instrument.js';
import { HomeScreen } from './screens/home.js';
import { MeasureScreen } from './screens/measure.js';
import { MemoryScreen } from './screens/memory.js';
import { ScanScreen } from './screens/scan.js';
import { mainMenu, clearUnsentConfirm } from './screens/menu.js';
import { LONG_MS, STOCK, PROPOSED, longMs, isProposed } from './profile.js';
import { Annotations } from './annotations.js';
import { defaultContent } from './callouts.js';

export { LONG_MS };

// Two arrows pressed within this long of each other count as one both-arrows press.
const PAIR_MS = 300;

// Screen factories by name.
export const SCREENS = {
  home: () => new HomeScreen(),
  measure: () => new MeasureScreen(),
  memory: () => new MemoryScreen(),
  scan: () => new ScanScreen(),
  menu: () => mainMenu(),
  clearUnsentFromMeasure: () => clearUnsentConfirm((ui) => ui.open('measure')),
};

export class Ui {
  constructor({ x1, instrument = null, profile = STOCK, content = null }) {
    this.x1 = x1;
    this.instrument = instrument ?? new Instrument(x1);
    this.profile = profile;
    this.content = content ?? defaultContent(); // { callouts, namePrefix, nameFirst }
    this.annotations = new Annotations();
    this.settings = defaultUiSettings();
    this.on = false;
    this.screen = null;
    this.down = new Map(); // button -> { at, fired }
    this.beeps = [];
    this.sent = new Set(); // shot indices already transferred
    this.lastInput = x1.now();
    this.onInput = null; // ({ t, button, kind, heldMs, screen }) => void
  }

  now() { return this.x1.now(); }

  get proposed() { return isProposed(this.profile); }

  setProfile(profile) {
    if (profile !== STOCK && profile !== PROPOSED) throw new Error(`Unknown profile: ${profile}`);
    this.profile = profile;
    this.powerOff();
    this.annotations.clear();
  }

  // ---- input ----------------------------------------------------------------
  press(b) {
    if (this.down.has(b)) return;
    this.lastInput = this.now();
    const entry = { at: this.now(), fired: false };
    this.down.set(b, entry);
    if (!this.on) {
      entry.fired = true; // nothing to do on release
      if (b === 'dist') {
        this._report('dist', 'tap', 0, 'off');
        this.powerOn();
      }
    }
  }

  release(b) {
    const e = this.down.get(b);
    this.down.delete(b);
    if (!e || !this.on) return;
    if (e.fired) {
      // A long press or chord was already reported at its threshold: report the extra hold.
      const extra = e.reported === undefined ? 0 : this.now() - e.at - e.reported;
      if (extra > 0) this._report(b, 'release', extra, this.screen?.constructor.name ?? 'off');
      return;
    }
    this.lastInput = this.now();
    // An arrow released while the other arrow is still down: one left+right tap.
    const other = b === 'left' ? 'right' : b === 'right' ? 'left' : null;
    const p = other ? this.down.get(other) : null;
    if (p && !p.fired && Math.abs(e.at - p.at) <= PAIR_MS) {
      p.fired = true;
      this._dispatch('left+right', 'tap', this.now() - Math.max(e.at, p.at));
      return;
    }
    this._dispatch(b, 'tap', this.now() - e.at);
  }

  // Call about every 100 ms: long presses, chords, idle power-off, screen timers.
  tick() {
    if (!this.on) return;
    const t = this.now();
    const d = this.down.get('dist');
    const m = this.down.get('m');
    const l = this.down.get('left');
    const r = this.down.get('right');
    if (d && m && !d.fired && !m.fired && t - Math.max(d.at, m.at) >= LONG_MS) {
      d.fired = true;
      m.fired = true;
      d.reported = t - d.at;
      m.reported = Infinity; // the hold is counted once, on DIST
      this._dispatch('dist+m', 'chord', t - Math.max(d.at, m.at));
    }
    if (l && r && !l.fired && !r.fired && Math.abs(l.at - r.at) <= PAIR_MS && t - Math.max(l.at, r.at) >= LONG_MS) {
      l.fired = true;
      r.fired = true;
      l.reported = t - l.at;
      r.reported = Infinity;
      this._dispatch('left+right', 'long', t - Math.max(l.at, r.at));
    }
    for (const [b, e] of this.down) {
      // While its chord partner is held and unfired, a button may still become part of a chord.
      let partner = b === 'dist' ? m : b === 'm' ? d : null;
      if (b === 'left' || b === 'right') {
        const o = b === 'left' ? r : l;
        if (o && Math.abs(e.at - o.at) <= PAIR_MS) partner = o; // only a near-simultaneous pair
      }
      if (partner && !partner.fired) continue;
      if (this.on && !e.fired && t - e.at >= longMs(this.profile, b)) {
        e.fired = true;
        e.reported = t - e.at;
        this._dispatch(b, 'long', t - e.at);
      }
    }
    if (!this.on) return;
    // A screen that works on its own (scan mode) keeps the X1 awake until it ends.
    if (!this.screen?.keepAwake && t - this.lastInput >= this.settings.idleOff * 1000) { this.powerOff(); return; }
    this.screen?.tick?.(this, t);
  }

  _report(button, kind, heldMs, screen) {
    this.onInput?.({ t: this.now(), button, kind, heldMs, screen });
  }

  _dispatch(b, kind, heldMs = 0) {
    this._report(b, kind, heldMs, this.screen?.constructor.name ?? 'off');
    if (b === 'clr' && kind === 'long' && !this.screen?.handlesLongClr) { this.powerOff(); return; }
    this.screen?.key?.(this, b, kind);
  }

  // ---- power ----------------------------------------------------------------
  powerOn() {
    this.on = true;
    this.x1.laser = false;
    this.open('home');
  }

  powerOff() {
    this.on = false;
    this.screen = null;
    this.x1.laser = false;
    this.x1.cali = false;
    this.down.clear();
  }

  // ---- screens --------------------------------------------------------------
  // open: a fresh screen (its enter() runs). resume: go back to a live one.
  open(name) {
    const make = SCREENS[name];
    if (!make) throw new Error(`Unknown screen: ${name}`);
    this.go(make());
  }
  go(screen) { this.screen = screen; screen.enter?.(this); }
  resume(screen) { this.screen = screen; }

  // Back to factory state for what the Ui keeps: settings, transfer flags, annotations.
  resetState() {
    Object.assign(this.settings, defaultUiSettings());
    this.sent.clear();
    this.annotations.clear();
  }

  scene() {
    if (!this.on || !this.screen) return scene([]);
    return this.screen.render(this);
  }

  backlight() { return this.on ? this.settings.backlight : 0; }

  // ---- beeps and transfer flags ----------------------------------------------
  beep(kind) { if (this.settings.beep) this.beeps.push(kind); }
  takeBeeps() { const b = this.beeps; this.beeps = []; return b; }

  isUnsent(i) { return !this.sent.has(i); }
  clearUnsent() { for (let i = 0; i < this.x1.memory.shots.length; i++) this.sent.add(i); }
}
