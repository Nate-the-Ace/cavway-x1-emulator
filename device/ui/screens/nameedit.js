import { scene } from '../scene.js';
import { MAX_NAME_LEN } from '../annotations.js';

export const NAME_CHARS = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.'];
export const END = 'OK';
const SCROLL = [...NAME_CHARS, END];

// Station-name entry on five buttons. '<' '>' scroll the character, M adds it (or
// finishes on OK), CLR deletes (cancels when empty), long CLR cancels, DIST finishes.
export class NameEditScreen {
  handlesLongClr = true;

  constructor({ initial = '', onDone, onCancel }) {
    this.name = initial.slice(0, MAX_NAME_LEN);
    this.idx = 0;
    this.onDone = onDone;
    this.onCancel = onCancel;
  }

  key(ui, b, kind) {
    if (kind === 'long') {
      if (b === 'clr') this.onCancel(ui);
      return;
    }
    if (kind !== 'tap') return;
    if (b === 'left') this.idx = (this.idx + SCROLL.length - 1) % SCROLL.length;
    else if (b === 'right') this.idx = (this.idx + 1) % SCROLL.length;
    else if (b === 'm') {
      const c = SCROLL[this.idx];
      if (c === END) this.onDone(ui, this.name);
      else if (this.name.length < MAX_NAME_LEN) {
        this.name += c;
        this.idx = 0;
      }
    } else if (b === 'dist') this.onDone(ui, this.name);
    else if (b === 'clr') {
      if (this.name.length) this.name = this.name.slice(0, -1);
      else this.onCancel(ui);
    }
  }

  render() {
    return scene(['STATION NAME', '', `  ${this.name}[${SCROLL[this.idx]}]`, '', '', '', '<>:Char M:Add DIST:OK', 'CLR:Del CLR2s:Cancel']);
  }
}
