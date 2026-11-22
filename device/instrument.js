// A virtual instrument: a pointing pose that Ui screens turn into shots.
import { Flag } from './shots.js';
import { view } from './ui/shotview.js';

// Accuracy error block for byte 45 on: absG error with plausible values.
export const ACC_ERR = Uint8Array.of(0x7f, 0x10, 0x27, 0x20, 0x27, 0xff, 0xff, 0xff, 0xff);

// Tolerances for "close shots" (a guess until measured on hardware).
const CLOSE_ANGLE_DEG = 2;
const CLOSE_DIST_FRACTION = 0.02;
const CLOSE_DIST_MIN_M = 0.05;

const angDiff = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const close = (a, b) =>
  angDiff(a.azimuth, b.azimuth) <= CLOSE_ANGLE_DEG &&
  Math.abs(a.inclination - b.inclination) <= CLOSE_ANGLE_DEG &&
  Math.abs(a.distance - b.distance) <= Math.max(CLOSE_DIST_MIN_M, CLOSE_DIST_FRACTION * b.distance);

export class Instrument {
  constructor(x1, pose = { az: 40, inc: -5, dist: 3 }) {
    this.x1 = x1;
    this.pose = { ...pose };
    this.forceErr = false;
    this.onLive = null; // (packet) => void, called for each live packet
  }

  // Take a shot from the current pose. Returns { index, leg, live } or null.
  fire({ flag = Flag.none, scan = false } = {}) {
    const { az, inc, dist } = this.pose;
    const leg = !scan && !this.x1.cali && this._closeToLastTwo();
    const before = this.x1.memory.shots.length;
    const live = this.x1.measure({
      splay: !leg, flag, distance: dist, azimuth: az, inclination: inc,
      err: this.forceErr ? ACC_ERR : null, scan,
    });
    const shots = this.x1.memory.shots;
    if (shots.length === before) return null;
    if (live && this.onLive) this.onLive(live);
    return { index: shots.length - 1, leg, live };
  }

  // The new shot is the third of a run when it is close to the last two,
  // and those two are close to each other.
  _closeToLastTwo() {
    const s = this.x1.memory.shots;
    if (s.length < 2) return false;
    const [a, b] = s.slice(-2).map(view);
    if (a.isScan || b.isScan || a.isCali || b.isCali) return false;
    const p = this.pose;
    return close(a, b) && close(b, { azimuth: p.az, inclination: p.inc, distance: p.dist });
  }
}
