import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist, fmtDate, fmtTime } from '../format.js';
import { view, MARKS } from '../shotview.js';
import { calloutLabel } from '../callouts.js';
import { shotMenu } from './shotmenu.js';

const NONE = 7;
const LIST_ROWS = 5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Memory mode. Position 0 is the newest shot; '<' goes newer, '>' older.
export class MemoryScreen {
  constructor() {
    this.cursor = 0;
    this.detail = null; // null: list; 0..3: detail page
  }

  _n(ui) { return ui.x1.memory.shots.length; }
  _index(ui, p) { return this._n(ui) - 1 - p; }

  key(ui, b, kind) {
    const n = this._n(ui);
    if (kind === 'long') {
      if (b === 'm' && ui.proposed && n > 0) {
        ui.go(shotMenu({ ui, index: this._index(ui, this.cursor), parent: this }));
      }
      return;
    }
    if (kind !== 'tap') return;
    const move = (d) => { this.cursor = clamp(this.cursor + d, 0, Math.max(0, n - 1)); };
    if (b === 'left') move(-1);
    else if (b === 'right') move(1);
    else if (this.detail === null) {
      if (b === 'm' && n > 0) this.detail = 0;
      else if (b === 'clr') ui.open('home');
    } else if (b === 'm') this.detail = (this.detail + 1) % 4;
    else if (b === 'clr') this.detail = null;
  }

  render(ui) {
    const n = this._n(ui);
    this.cursor = clamp(this.cursor, 0, Math.max(0, n - 1)); // memory may shrink under us
    if (n === 0) return scene(['SHOT #  -', '', '', 'No data']);
    return this.detail === null ? this._list(ui, n) : this._detail(ui, n);
  }

  _list(ui, n) {
    const s = ui.settings;
    const start = Math.max(0, this.cursor - (LIST_ROWS - 1));
    const rows = [lr(`SHOT # ${n - this.cursor}`, ui.annotations.name(this._index(ui, this.cursor))), 'DIST AZM°INCL°'];
    const bold = [];
    for (let p = start; p < Math.min(n, start + LIST_ROWS); p++) {
      const i = this._index(ui, p);
      const v = view(ui.x1.memory.shots[i]);
      const flag = v.hasErr ? 'E' : v.isCali ? 'C' : v.isScan ? 'S' : ' ';
      const tail = (ui.isUnsent(i) ? '*' : ' ') + (v.mark !== NONE || ui.annotations.tag(i) ? '_' : ' ');
      // Keep each column 5 wide: drop a decimal when the value would not fit.
      const num = (x, d) => {
        const t = x.toFixed(d);
        return (t.length > 5 ? x.toFixed(Math.max(0, d - 1)) : t).padStart(5);
      };
      if (v.isLeg && !v.isCali && !v.isScan) bold.push(rows.length);
      rows.push(`${flag} ${num(distIn(v.distance, s.distUnit), 2)} ${num(angIn(v.azimuth, s.angleUnit), 1)} ${num(angIn(v.inclination, s.angleUnit), 1)}${tail}`);
    }
    return scene(rows, { invert: [2 + (this.cursor - start)], bold });
  }

  _detail(ui, n) {
    const s = ui.settings;
    const i = this._index(ui, this.cursor);
    const v = view(ui.x1.memory.shots[i]);
    const head = lr(`SHOT # ${n - this.cursor}`, `${ui.annotations.name(i)}${ui.isUnsent(i) ? ' *' : ''}`.trim());
    const foot = ['< >:Prev/Next shot', `M:Next page (${this.detail + 1}/4)`];
    let body;
    if (this.detail === 0) {
      body = [
        lr('DIST:', fmtDist(v.distance, s.distUnit)),
        lr('AZM:', fmtAngle(v.azimuth, s.angleUnit)),
        lr('INCL:', fmtAngle(v.inclination, s.angleUnit)),
        `${fmtDate(v.time)} ${fmtTime(v.time).slice(0, 5)}`,
        v.hasErr ? 'Accuracy Error' : '',
      ];
    } else if (this.detail === 1) {
      const inc = (v.inclination * Math.PI) / 180;
      body = [
        lr('Horizontal', fmtDist(v.distance * Math.cos(inc), s.distUnit)),
        lr('Vertical', fmtDist(v.distance * Math.sin(inc), s.distUnit)),
        lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
      ];
    } else if (this.detail === 2) {
      body = v.hasErr ? v.errKinds.map((k) => `${k} error`) : ['No error'];
    } else {
      body = [
        lr('absG:', `${v.absG.toFixed(3)}g`),
        lr('absM:', `${v.absM.toFixed(2)}uT`),
        lr('Dip:', fmtAngle(v.dip, s.angleUnit)),
        lr('Mark:', MARKS[v.mark]),
        ...(ui.annotations.tag(i) ? [lr('Tag:', calloutLabel(ui.content.callouts, ui.annotations.tag(i)))] : []),
      ];
    }
    const rows = [head, ...body];
    while (rows.length < 6) rows.push('');
    return scene([...rows.slice(0, 6), ...foot]);
  }
}

const distIn = (m, unit) => (unit === 'ft' ? m * 3.28084 : m);
const angIn = (d, unit) => (unit === 'grad' ? (d * 400) / 360 : d);
