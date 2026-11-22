import { scene } from '../scene.js';
import { calloutCode, calloutLabel } from '../callouts.js';

const VISIBLE = 5;

// Two levels: "Recent" (if any) and the categories, then the items of one of them.
// onPick(ui, code) and onCancel(ui) say what happens next.
export class PickerScreen {
  constructor({ onPick, onCancel }) {
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.level = 0;
    this.cursor = 0;
    this.saved0 = 0; // level-one cursor, restored on the way back
    this.category = null; // a category index, or 'recent'
  }

  _recent(ui) {
    return ui.annotations.recent
      .map((code) => ({ code, label: calloutLabel(ui.content.callouts, code) }))
      .filter((r) => r.label);
  }

  _rows(ui) {
    const cats = ui.content.callouts;
    if (this.level === 0) {
      const rows = [];
      if (this._recent(ui).length) rows.push({ label: 'Recent', recent: true });
      cats.forEach((c, i) => rows.push({ label: c.name, cat: i }));
      return rows;
    }
    if (this.category === 'recent') return this._recent(ui).map((r) => ({ label: r.label, code: r.code }));
    return cats[this.category].items.map((name, i) => ({ label: name, code: calloutCode(this.category, i) }));
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const rows = this._rows(ui);
    if (b === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (b === 'right') this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    else if (b === 'm') {
      const row = rows[this.cursor];
      if (!row) return;
      if (this.level === 0) {
        this.saved0 = this.cursor;
        this.category = row.recent ? 'recent' : row.cat;
        this.level = 1;
        this.cursor = 0;
      } else {
        ui.beep('short');
        this.onPick(ui, row.code);
      }
    } else if (b === 'clr') {
      if (this.level === 1) {
        this.level = 0;
        this.cursor = this.saved0;
      } else this.onCancel(ui);
    }
  }

  render(ui) {
    const rows = this._rows(ui);
    this.cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
    const start = Math.max(0, this.cursor - (VISIBLE - 1));
    const title = this.level === 0 ? 'CALLOUT' : this.category === 'recent' ? 'Recent' : ui.content.callouts[this.category].name;
    const out = [title];
    for (let i = start; i < Math.min(rows.length, start + VISIBLE); i++) {
      out.push(`${i === this.cursor ? '> ' : '  '}${rows[i].label}`);
    }
    while (out.length < 6) out.push('');
    return scene([...out, '< >:Move M:Select', 'CLR:Back']);
  }
}
