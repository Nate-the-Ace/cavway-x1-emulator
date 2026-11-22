import { FakeClock } from './helpers.js';
import { X1 } from '../device/x1.js';
import { Ui } from '../device/ui/ui.js';
import { sceneText } from '../device/ui/scene.js';

// A UI on a fake clock. run(ms) advances time and ticks the UI every 100 ms.
export function rig(opts = {}) {
  const clock = new FakeClock();
  const x1 = new X1({ now: clock.now, ...opts.x1 });
  const ui = new Ui({ x1, ...opts.ui });
  const run = (ms) => {
    for (let left = ms; left > 0; left -= 100) {
      clock.advance(Math.min(100, left));
      ui.tick();
    }
  };
  const tap = (b) => { ui.press(b); ui.release(b); };
  const hold = (b, ms) => { ui.press(b); run(ms); ui.release(b); };
  const text = () => sceneText(ui.scene());
  const name = () => ui.screen?.constructor.name ?? null;
  return { clock, x1, ui, run, tap, hold, text, name };
}
