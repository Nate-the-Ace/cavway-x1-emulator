import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist } from '../format.js';
import { view, MARKS, MARK_CYCLE } from '../shotview.js';
import { calloutLabel } from '../callouts.js';
import { PickerScreen } from './picker.js';
import { shotMenu } from './shotmenu.js';

const NONE = 7;

// Laser on, then shot, then result pages.
export class MeasureScreen {
  constructor() {
    this.mark = NONE;
    this.tag = 0; // callout picked before the shot (proposed profile)
    this.result = null; // { index, leg } once a shot was taken
    this.page = 0;
    this.dueAt = null; // delayed shot time
  }

  enter(ui) { this.arm(ui); }

  // The shots may have been cleared or reset under a result page: start over armed.
  _sync(ui) {
    if (this.result && !ui.x1.memory.shots[this.result.index]) this.arm(ui);
  }

  arm(ui) {
    this.result = null;
    this.page = 0;
    this.dueAt = null;
    this.tag = 0;
    ui.x1.laser = true;
  }

  take(ui) {
    this.dueAt = null;
    // x1.measure() clears the laser itself; if the shot fails the laser stays on.
    const r = ui.instrument.fire({ flag: this.mark });
    if (!r) return;
    this.result = r;
    this.page = 0;
    this.mark = NONE;
    if (this.tag) ui.annotations.setTag(r.index, this.tag);
    this.tag = 0;
    ui.beep(view(ui.x1.memory.shots[r.index]).hasErr ? 'long' : 'short');
    if (r.leg) ui.beep('double');
  }

  key(ui, b, kind) {
    this._sync(ui);
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
      } else if (b === 'm' && ui.proposed) {
        if (armed) {
          this.dueAt = null; // a pending delayed shot is cancelled while picking
          ui.go(new PickerScreen({
            onPick: (u, code) => { this.tag = code; u.resume(this); },
            onCancel: (u) => u.resume(this),
          }));
        } else ui.go(shotMenu({ ui, index: this.result.index, parent: this }));
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
    this._sync(ui);
    if (this.dueAt !== null && t >= this.dueAt) this.take(ui);
  }

  render(ui) {
    const s = ui.settings;
    this._sync(ui);
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
    if (this.tag) rows[6] = `Tag: ${calloutLabel(ui.content.callouts, this.tag)}`;
    if (this.dueAt !== null) rows[7] = `Shot in ${Math.ceil((this.dueAt - ui.now()) / 1000)}s`;
    return scene(rows);
  }

  _result(ui) {
    const s = ui.settings;
    const v = view(ui.x1.memory.shots[this.result.index]);
    if (this.page === 1) {
      const errs = v.hasErr ? v.errKinds.map((k) => `${k} error`) : ['No error'];
      const rows = ['Accuracy Error', ...errs];
      while (rows.length < 6) rows.push('');
      return scene([...rows, '< >:Prev/Next page', 'M:Menu CLR:Home']);
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
    const tag = calloutLabel(ui.content.callouts, ui.annotations.tag(this.result.index));
    const name = ui.annotations.name(this.result.index);
    return scene([
      lr('AZM', fmtAngle(v.azimuth, s.angleUnit)),
      lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
      '',
      v.mark === NONE ? '' : lr('', MARKS[v.mark]),
      lr(v.isLeg ? 'LEG' : '', v.hasErr ? 'ACC ERR' : ''),
      lr('DIST', fmtDist(v.distance, s.distUnit)),
      tag ? `Tag: ${tag}` : '',
      name ? `Stn: ${name}` : '',
    ]);
  }
}

const fmtDistPlaceholder = (unit) => `---- ${unit}`;
