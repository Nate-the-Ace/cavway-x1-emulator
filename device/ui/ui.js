// The X1's front panel as a state machine: five buttons in, a scene out.
import { scene } from './scene.js';
import { defaultUiSettings } from './settings.js';
import { Instrument } from '../instrument.js';
import { HomeScreen } from './screens/home.js';
import { MeasureScreen } from './screens/measure.js';
import { MemoryScreen } from './screens/memory.js';
import { ScanScreen } from './screens/scan.js';
import { mainMenu, clearUnsentConfirm } from './screens/menu.js';

export const LONG_MS = 2000;

// Screen factories by name. Later tasks add their screens here.
export const SCREENS = {
  home: () => new HomeScreen(),
  measure: () => new MeasureScreen(),
  memory: () => new MemoryScreen(),
  scan: () => new ScanScreen(),
  menu: () => mainMenu(),
  clearUnsentFromMeasure: () => clearUnsentConfirm((ui) => ui.open('measure')),
};

export class Ui {
  constructor({ x1, instrument = null, profile = 'stock-1.1.7' }) {
    this.x1 = x1;
    this.instrument = instrument ?? new Instrument(x1);
    this.profile = profile;
    this.settings = defaultUiSettings();
    this.on = false;
    this.screen = null;
    this.down = new Map(); // button -> { at, fired }
    this.beeps = [];
    this.sent = new Set(); // shot indices already transferred
    this.lastInput = x1.now();
  }

  now() { return this.x1.now(); }

  // ---- input ----------------------------------------------------------------
  press(b) {
    if (this.down.has(b)) return;
    this.lastInput = this.now();
    const entry = { at: this.now(), fired: false };
    this.down.set(b, entry);
    if (!this.on) {
      entry.fired = true; // nothing to do on release
      if (b === 'dist') this.powerOn();
    }
  }

  release(b) {
    const e = this.down.get(b);
    this.down.delete(b);
    if (!e || e.fired || !this.on) return;
    this.lastInput = this.now();
    this._dispatch(b, 'tap');
  }

  // Call about every 100 ms: long presses, chords, idle power-off, screen timers.
  tick() {
    if (!this.on) return;
    const t = this.now();
    const d = this.down.get('dist');
    const m = this.down.get('m');
    if (d && m && !d.fired && !m.fired && t - Math.max(d.at, m.at) >= LONG_MS) {
      d.fired = true;
      m.fired = true;
      this._dispatch('dist+m', 'chord');
    }
    for (const [b, e] of this.down) {
      // While its chord partner is held and unfired, DIST or M may still become a chord.
      const partner = b === 'dist' ? m : b === 'm' ? d : null;
      if (partner && !partner.fired) continue;
      if (this.on && !e.fired && t - e.at >= LONG_MS) {
        e.fired = true;
        this._dispatch(b, 'long');
      }
    }
    if (!this.on) return;
    // A screen that works on its own (scan mode) keeps the X1 awake until it ends.
    if (!this.screen?.keepAwake && t - this.lastInput >= this.settings.idleOff * 1000) { this.powerOff(); return; }
    this.screen?.tick?.(this, t);
  }

  _dispatch(b, kind) {
    if (b === 'clr' && kind === 'long') { this.powerOff(); return; }
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
  // Screens not yet registered are ignored.
  open(name) {
    const make = SCREENS[name];
    if (!make) throw new Error(`Unknown screen: ${name}`);
    this.go(make());
  }
  go(screen) { this.screen = screen; screen.enter?.(this); }
  resume(screen) { this.screen = screen; }

  // Back to factory state for what the Ui keeps: settings and transfer flags.
  resetState() {
    Object.assign(this.settings, defaultUiSettings());
    this.sent.clear();
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
