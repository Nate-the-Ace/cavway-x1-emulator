import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist } from '../format.js';
import { view, MARKS, MARK_CYCLE } from '../shotview.js';

const NONE = 7;

// Laser on, then shot, then result pages.
export class MeasureScreen {
  constructor() {
    this.mark = NONE;
    this.result = null; // { index, leg } once a shot was taken
    this.page = 0;
    this.dueAt = null; // delayed shot time
  }

  enter(ui) { this.arm(ui); }

  arm(ui) {
    this.result = null;
    this.page = 0;
    this.dueAt = null;
    ui.x1.laser = true;
  }

  take(ui) {
    this.dueAt = null;
    const r = ui.instrument.fire({ flag: this.mark });
    ui.x1.laser = false;
    if (!r) return;
    this.result = r;
    this.page = 0;
    this.mark = NONE;
    ui.beep(view(ui.x1.memory.shots[r.index]).hasErr ? 'long' : 'short');
    if (r.leg) ui.beep('double');
  }

  key(ui, b, kind) {
    const armed = this.result === null;
    const s = ui.settings;
    if (b === 'dist+m') {
      if (armed && s.scanEnable && s.scanTrigger === 'DIST+M') ui.open('scan');
      return;
    }
    if (kind === 'long') {
      if (b === 'dist' && armed) {
        if (s.shotDelay === 0) this.take(ui);
        else this.dueAt = ui.now() + s.shotDelay * 1000;
      } else if (b === 'right') {
        // Scan can use '>' as its trigger; otherwise it is the clear-unsent hotkey.
        if (s.scanEnable && s.scanTrigger === '>') ui.open('scan');
        else ui.open('clearUnsentFromMeasure');
      }
      return;
    }
    if (kind !== 'tap') return;
    if (b === 'dist') {
      if (this.dueAt !== null) this.dueAt = null;
      else if (armed) this.take(ui);
      else this.arm(ui);
    } else if (b === 'm') {
      if (armed) this.mark = MARK_CYCLE[(MARK_CYCLE.indexOf(this.mark) + 1) % MARK_CYCLE.length];
      else ui.open('menu');
    } else if (b === 'left' || b === 'right') {
      if (armed) { ui.x1.laser = false; ui.open('memory'); }
      else this.page = (this.page + (b === 'right' ? 1 : 2)) % 3;
    } else if (b === 'clr') {
      ui.x1.laser = false;
      ui.open('home');
    }
  }

  tick(ui, t) {
    if (this.dueAt !== null && t >= this.dueAt) this.take(ui);
  }

  render(ui) {
    const s = ui.settings;
    if (this.result) return this._result(ui);
    const p = ui.instrument.pose;
    const rows = [
      lr('AZM', fmtAngle(p.az, s.angleUnit)),
      lr('INCL', fmtAngle(p.inc, s.angleUnit)),
      '',
      this.mark === NONE ? '' : lr('', MARKS[this.mark]),
      '',
      lr('DIST', fmtDistPlaceholder(s.distUnit)),
    ];
    if (this.dueAt !== null) rows[6] = `Shot in ${Math.ceil((this.dueAt - ui.now()) / 1000)}s`;
    return scene(rows);
  }

  _result(ui) {
    const s = ui.settings;
    const v = view(ui.x1.memory.shots[this.result.index]);
    if (this.page === 1) {
      const errs = v.hasErr ? v.errKinds.map((k) => `${k} error`) : ['No error'];
      return scene(['Accuracy Error', ...errs, '', '', '', '< >:Prev/Next page', 'M:Menu CLR:Home']);
    }
    if (this.page === 2) {
      const inc = (v.inclination * Math.PI) / 180;
      return scene([
        lr('Horizontal', fmtDist(v.distance * Math.cos(inc), s.distUnit)),
        lr('Vertical', fmtDist(v.distance * Math.sin(inc), s.distUnit)),
        lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
        '', '', '', '< >:Prev/Next page', 'M:Menu CLR:Home',
      ]);
    }
    return scene([
      lr('AZM', fmtAngle(v.azimuth, s.angleUnit)),
      lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
      '',
      v.mark === NONE ? '' : lr('', MARKS[v.mark]),
      lr(v.isLeg ? 'LEG' : '', v.hasErr ? 'ACC ERR' : ''),
      lr('DIST', fmtDist(v.distance, s.distUnit)),
    ]);
  }
}

const fmtDistPlaceholder = (unit) => `---- ${unit}`;
