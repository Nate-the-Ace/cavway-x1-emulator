import { scene } from '../scene.js';
import { calloutCode } from '../callouts.js';

const VISIBLE = 5;

// One flat list of callouts. onPick(ui, code) and onCancel(ui) say what happens next.
export class PickerScreen {
  constructor({ onPick, onCancel }) {
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.cursor = 0;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const items = ui.content.callouts;
    if (b === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (b === 'right') this.cursor = Math.max(0, Math.min(items.length - 1, this.cursor + 1));
    else if (b === 'm') {
      if (!items[this.cursor]) return;
      ui.beep('short');
      this.onPick(ui, calloutCode(this.cursor));
    } else if (b === 'clr') this.onCancel(ui);
  }

  render(ui) {
    const items = ui.content.callouts;
    this.cursor = Math.min(this.cursor, Math.max(0, items.length - 1));
    const out = ['CALLOUT'];
    if (items.length === 0) out.push('No callouts');
    else {
      const start = Math.max(0, this.cursor - (VISIBLE - 1));
      for (let i = start; i < Math.min(items.length, start + VISIBLE); i++) {
        out.push(`${i === this.cursor ? '> ' : '  '}${items[i]}`);
      }
    }
    while (out.length < 6) out.push('');
    return scene([...out, '< >:Move M:Select', 'CLR:Cancel']);
  }
}
