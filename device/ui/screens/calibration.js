import { scene, lr } from '../scene.js';
import { fmtAngle } from '../format.js';
import { ADDR } from '../../memory.js';

const MAX_GROUPS = 25;
const MIN_GROUPS = 9; // "more than eight" complete groups

// The report is canned (taken from the manual's screenshot), not computed.
const REPORT = { avg: 25, stddev: 28, max: 128, dip: 5730 };

export class CalibrationScreen {
  enter(ui) {
    this.groups = 0; // completed groups
    this.inGroup = 0; // shots in the current group, 0..3
    this.done = false; // true right after a group completed, until the next shot
    ui.x1.cali = true;
    ui.x1.laser = true;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'dist') this._shoot(ui);
    else if (b === 'right') this._reset();
    else if (b === 'm') {
      if (this.groups >= MIN_GROUPS) ui.go(new CalibrationReport(this));
      else ui.beep('short');
    } else if (b === 'clr') {
      ui.x1.cali = false;
      ui.x1.laser = false;
      ui.open('home');
    }
  }

  _shoot(ui) {
    if (this.groups >= MAX_GROUPS) { ui.beep('long'); return; }
    this.done = false;
    const r = ui.instrument.fire({});
    ui.x1.laser = true;
    if (!r) return;
    this.inGroup++;
    if (this.inGroup === 4) {
      this.groups++;
      this.inGroup = 0;
      this.done = true;
      ui.beep('double');
    } else ui.beep('short');
  }

  _reset() {
    if (this.done) { this.groups--; this.done = false; }
    this.inGroup = 0;
  }

  render(ui) {
    const p = ui.instrument.pose;
    const g = this.done ? this.groups : this.groups + 1;
    const n = this.done ? 4 : this.inGroup;
    return scene(['', lr('AZM', fmtAngle(p.az)), lr('INCL', fmtAngle(p.inc)), `Group ${g}`, `${n} / 4`, '', '>:Reset Group', 'CLR:Exit']);
  }
}

export class CalibrationReport {
  constructor(parent) {
    this.parent = parent;
    this.applied = false;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm' && !this.applied) { this._apply(ui); this.applied = true; }
    else if (b === 'clr') ui.resume(this.parent);
  }

  _apply(ui) {
    const t = ui.x1.memory.clock();
    const info = new Uint8Array(16).fill(0xff);
    const put16 = (at, v) => { info[at] = v & 0xff; info[at + 1] = (v >> 8) & 0xff; };
    info[0] = 0x55;
    info[1] = 0x01;
    info.set([t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, t >>> 24], 2);
    put16(6, REPORT.avg);
    put16(8, REPORT.stddev);
    put16(10, REPORT.max);
    put16(12, REPORT.dip);
    ui.x1.memory.write(ADDR.caliInfo, info);
    ui.beep('short');
  }

  render() {
    if (this.applied) return scene(['', '', 'Calibration', '  Updated']);
    return scene([
      'Sensor 1', 'Aver. Error: 0.25°', 'Err Stddev: 0.28°', 'Max Err: 1.28°',
      'Iterations: 36', 'Magn. Dip: 57.30°', '<>:Scroll report', 'M:Apply CLR:Exit',
    ]);
  }
}
