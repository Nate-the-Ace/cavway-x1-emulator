import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist } from '../format.js';

// How long the pose must hold still before a scan shot (a guess).
const SETTLE_MS = { Low: 1200, 'Med.': 700, High: 300 };
const MAX_SHOTS = 200;

export class ScanScreen {
  keepAwake = true;

  enter(ui) {
    this.count = 0;
    this.start = ui.now();
    this.key0 = null; // pose seen on the last tick
    this.stableSince = ui.now();
    this.shotKey = null; // pose of the last scan shot
    ui.x1.laser = true;
  }

  key(ui, b, kind) {
    if (kind === 'tap' && b === 'clr') this.exit(ui);
  }

  tick(ui, t) {
    const p = ui.instrument.pose;
    const k = `${p.az}|${p.inc}|${p.dist}`;
    if (k !== this.key0) {
      this.key0 = k;
      this.stableSince = t;
    } else if (k !== this.shotKey && t - this.stableSince >= SETTLE_MS[ui.settings.scanSpeed]) {
      if (!ui.instrument.fire({ scan: true })) { this.exit(ui); return; } // memory full or X1 busy
      this.count++;
      this.shotKey = k;
      ui.x1.laser = true;
    }
    if (this.count >= MAX_SHOTS || t - this.start >= ui.settings.scanMinutes * 60_000) this.exit(ui);
  }

  exit(ui) {
    ui.x1.laser = false;
    ui.lastInput = ui.now(); // the idle timer starts over when scanning ends
    ui.open('measure');
  }

  render(ui) {
    const s = ui.settings;
    const p = ui.instrument.pose;
    return scene([
      'SCAN MODE',
      lr('AZM', fmtAngle(p.az, s.angleUnit)),
      lr('INCL', fmtAngle(p.inc, s.angleUnit)),
      lr('', `${String(this.count).padStart(3, '0')} SHOTS`),
      lr('DIST', fmtDist(p.dist, s.distUnit)),
    ]);
  }
}
