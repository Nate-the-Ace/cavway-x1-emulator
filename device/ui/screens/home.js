import { scene } from '../scene.js';
import { fmtDate, fmtTime } from '../format.js';

// Shown right after power on: the date and the time.
export class HomeScreen {
  render(ui) {
    const t = ui.x1.memory.clock();
    return scene(['', '', `   ${fmtDate(t)}`, `    ${fmtTime(t)}`]);
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'dist') ui.open('measure');
    else if (b === 'left' || b === 'right') ui.open('memory');
    else if (b === 'm') ui.open('menu');
  }
}
