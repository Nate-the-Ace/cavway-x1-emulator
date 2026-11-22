# X1 UI Model (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a behavioral model of the stock Cavway X1 interface (five buttons, text-grid screen, menus, marks, memory, scan, calibration) to the emulator, with a panel front face you can click and type at.

**Architecture:** A pure state machine, `Ui` (`device/ui/`), takes button press/release events and clock ticks and produces a "scene" (21x8 text grid with inverse/bold rows), beeps and a backlight level. An `Instrument` (`device/instrument.js`) turns a virtual pointing pose into shot records through the existing `X1.measure`. The panel draws the scene on a canvas and forwards clicks and keys. Spec: `docs/superpowers/specs/2026-11-22-x1-ui-emulator-design.md`.

**Tech Stack:** Plain JavaScript ES modules, `node --test` (run with `npm test`), no dependencies. Panel is a Chrome extension side panel, also served by `node dev/serve.mjs`.

**User decisions (already made):**
- "Run the real firmware binary" was chosen first, then the user agreed to "Yes, hybrid": behavioral UI model first, real firmware later as a check.
- "USB serial and BLE (Recommended)": both links are in scope for the whole project, but this plan is phase 1 only (UI model). BLE is phase 2.
- Design approved ("Looks right"); this plan is approved to be written ("Approve, write plan").
- Work is on branch `design/x1-ui-emulator`.

**Scope of this plan:** stock profile only. Not included: BLE shim, proposed profile (callouts, name editor), real-firmware comparison, the lock-and-power-off chord (`CLR`+`>`), persisting UI state across panel reloads.

**Things the executor must know (verified by reading the repo):**
- `device/shots.js` stores `flag` in bits 1-3 of byte 1 (`Flag = { feature: 0, ridge: 1, backsight: 2, generic: 3, none: 7 }`), the splay bit is bit 7 (set means NOT a leg), bit 0 clear means calibration shot.
- `X1.measure()` in `device/x1.js` stores a shot, clears `laser`, and returns a live packet only when the host port is open and `streamLive` is on. It returns `null` while booting or when the firmware is not in `app` state.
- `test/helpers.js` has `FakeClock` (`now`, `advance(ms)`). `X1` takes `{ now }`.
- `Memory.read(addr)` for `addr < 0x8000` returns `shots[addr]` (oldest first). The protocol PDF says address 0 is the *most recent* shot. That mismatch already exists and is out of scope here; the UI reads `memory.shots` directly, newest last.
- Device clock is "local time written as if UTC" (`Memory.clock()`), so tests derive expected dates from `x1.memory.clock()`, never from hard-coded strings (timezone dependent).
- Values marked "guess" below (settle times, close-shot tolerances, canned calibration numbers, scan bit 0x40) are not measured. Phase 3 corrects them.

---

## File structure

```
device/shots.js                 modify: add `scan` option (bit 6)
device/x1.js                    modify: measure() accepts `err` and `scan`
device/instrument.js            create: pose, fire(), leg detection, forced ACC ERR
device/ui/scene.js              create: grid constants, scene(), lr(), sceneText()
device/ui/format.js             create: angle, distance, date, time formatting
device/ui/shotview.js           create: decode a 64-byte record for display
device/ui/settings.js           create: UI settings defaults
device/ui/ui.js                 create: Ui class, input timing, power, screen registry
device/ui/screens/home.js       create: clock screen
device/ui/screens/measure.js    create: laser/shot/marks/result pages
device/ui/screens/memory.js     create: memory list and detail pages
device/ui/screens/menu.js       create: list engine, menus, info, confirm, time editor
device/ui/screens/scan.js       create: scan mode
device/ui/screens/calibration.js create: calibration groups and report
panel/keys.js                   create: keyboard map (pure)
panel/face.js                   create: canvas drawing and button wiring
panel/panel.html, panel.css, panel.js   modify: mount the face
test/ui-helpers.js              create: rig() for UI tests
test/ui-scene.test.js, instrument.test.js, ui-core.test.js, ui-measure.test.js,
test/ui-memory.test.js, ui-menu.test.js, ui-scan.test.js, ui-calibration.test.js,
test/face-keys.test.js          create
README.md                       modify: document the front face
```

---

### Task 1: Scene, formatting and shot decoding

**Goal:** The pure building blocks every screen uses: a 21x8 scene, formatters, and a record decoder for display.

**Files:**
- Modify: `device/shots.js` (add `scan` option)
- Create: `device/ui/scene.js`, `device/ui/format.js`, `device/ui/shotview.js`
- Test: `test/ui-scene.test.js`

**Acceptance Criteria:**
- [ ] `scene()` always returns exactly 8 rows of exactly 21 characters
- [ ] `lr('AZM', '66.7°')` right-aligns and long left text is clipped so the right text survives
- [ ] `view()` decodes leg flag, calibration flag, scan flag, mark, distance, azimuth, inclination, time and accuracy-error kinds
- [ ] `encodeShot({ scan: true })` sets bit 6 of byte 1

**Verify:** `node --test test/ui-scene.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-scene.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scene, sceneText, lr, COLS, ROWS } from '../device/ui/scene.js';
import { fmtAngle, fmtDist, fmtDate, fmtTime } from '../device/ui/format.js';
import { view, MARKS, MARK_CYCLE } from '../device/ui/shotview.js';
import { encodeShot, Flag } from '../device/shots.js';

test('scene pads and clips to the grid', () => {
  const s = scene(['hello', 'x'.repeat(40)]);
  assert.equal(s.rows.length, ROWS);
  assert.ok(s.rows.every((r) => r.length === COLS));
  assert.equal(s.rows[1], 'x'.repeat(COLS));
  assert.equal(sceneText(scene(['hi'])).split('\n')[0], 'hi');
});

test('lr right-aligns and clips the left side', () => {
  assert.equal(lr('AZM', '66.7°'), 'AZM' + ' '.repeat(COLS - 8) + '66.7°');
  const clipped = lr('x'.repeat(30), 'R');
  assert.equal(clipped.length, COLS);
  assert.ok(clipped.endsWith('R'));
});

test('formatters', () => {
  assert.equal(fmtAngle(66.74), '66.7°');
  assert.equal(fmtAngle(90, 'grad'), '100.0g');
  assert.equal(fmtDist(2.9584), '2.958 m');
  assert.equal(fmtDist(1, 'ft'), '3.28 ft');
  assert.equal(fmtDate(0), '1970-01-01');
  assert.equal(fmtTime(3661), '01:01:01');
});

test('marks table matches the shot flag values', () => {
  assert.equal(MARKS[Flag.none], 'None');
  assert.equal(MARKS[Flag.backsight], 'Backsight');
  assert.deepEqual(MARK_CYCLE, [Flag.none, Flag.feature, Flag.ridge, Flag.backsight, Flag.generic]);
});

test('view decodes a record', () => {
  const rec = encodeShot({
    time: 1_700_000_000, distance: 5.26, azimuth: 163.8, inclination: -22.2,
    splay: false, flag: Flag.backsight, err: Uint8Array.of(0x7f, 1, 2, 3, 4, 5, 6, 7, 8),
  });
  const v = view(rec);
  assert.equal(v.isLeg, true);
  assert.equal(v.isCali, false);
  assert.equal(v.isScan, false);
  assert.equal(v.mark, Flag.backsight);
  assert.equal(v.distance, 5.26);
  assert.ok(Math.abs(v.azimuth - 163.8) < 0.01);
  assert.ok(Math.abs(v.inclination + 22.2) < 0.01);
  assert.equal(v.time, 1_700_000_000);
  assert.equal(v.hasErr, true);
  assert.deepEqual(v.errKinds, ['absG']);
  const plain = view(encodeShot({ time: 1, distance: 1, azimuth: 0, inclination: 0, splay: true, scan: true }));
  assert.equal(plain.isScan, true);
  assert.equal(plain.isLeg, false);
  assert.equal(plain.hasErr, false);
  assert.deepEqual(plain.errKinds, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-scene.test.js`
Expected: FAIL with `Cannot find module '../device/ui/scene.js'`

- [ ] **Step 3: Write the implementation**

Edit `device/shots.js`. In the `encodeShot` parameter list add `scan = false`, and change the flag byte line:

```js
export function encodeShot({
  time, distance, azimuth, inclination, splay = false, cali = false, scan = false, flag = Flag.none,
  absG = 1, absM = 48, dip = 60, roll = 0, noise = 0, err = null,
}) {
  const s = new Uint8Array(64).fill(0xff);
  s[0] = 0x00;
  s[1] = (splay ? 0x80 : 0) | (scan ? 0x40 : 0) | ((flag & 7) << 1) | (cali ? 0 : 1);
```

(Everything else in the function is unchanged. Bit 6 for scan shots is a guess, taken from CaveCAD commit messages, not from the vendor.)

Create `device/ui/scene.js`:

```js
// What the UI model draws: a text grid. Phase 3 will add real pixels.
export const COLS = 21;
export const ROWS = 8;

// Left text and right text on one row; the left side is clipped to make room.
export function lr(left, right) {
  const room = Math.max(0, COLS - right.length);
  return left.slice(0, room).padEnd(room) + right;
}

export function scene(rows = [], { invert = [], bold = [] } = {}) {
  const out = Array.from({ length: ROWS }, (_, i) => (rows[i] ?? '').padEnd(COLS).slice(0, COLS));
  return { rows: out, invert: [...invert], bold: [...bold] };
}

export const sceneText = (s) => s.rows.map((r) => r.trimEnd()).join('\n');
```

Create `device/ui/format.js`:

```js
const pad = (n, w = 2) => String(n).padStart(w, '0');

export function fmtAngle(deg, unit = 'deg') {
  return unit === 'grad' ? `${((deg * 400) / 360).toFixed(1)}g` : `${deg.toFixed(1)}°`;
}

export function fmtDist(m, unit = 'm') {
  return unit === 'ft' ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(3)} m`;
}

// Device clock seconds are "local time as UTC", so read them with the UTC getters.
export function fmtDate(t) {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
```

Create `device/ui/shotview.js`:

```js
// Decode a 64-byte shot record for display, following Shot.cs.
export const MARKS = { 7: 'None', 0: 'Feature', 1: 'Ridge', 2: 'Backsight', 3: 'Generic' };
export const MARK_CYCLE = [7, 0, 1, 2, 3];

// Accuracy error byte 45: a cleared bit means that kind of error is present.
const ERR_BITS = [[7, 'absG'], [6, 'absM'], [5, 'dip'], [4, 'angle']];

export function view(rec) {
  const i16 = (v) => (v << 16) >> 16;
  const f = rec[1];
  const hasErr = rec[45] !== 0xff;
  return {
    isLeg: (f & 0x80) === 0,
    isCali: (f & 0x01) === 0,
    isScan: (f & 0x40) !== 0,
    mark: (f >> 1) & 7,
    distance: ((rec[2] << 16) | (rec[4] << 8) | rec[3]) / 1000,
    azimuth: (((rec[6] << 8) | rec[5]) * 360) / 65535,
    inclination: (i16((rec[8] << 8) | rec[7]) * 360) / 65535,
    absG: ((rec[11] | (rec[12] << 8)) * 667) / 1000 / 16384,
    absM: ((rec[13] | (rec[14] << 8)) * 4876) / 100 / 16384,
    dip: ((rec[15] | (rec[16] << 8)) * 360) / 65535,
    time: ((rec[20] << 24) | (rec[19] << 16) | (rec[18] << 8) | rec[17]) >>> 0,
    hasErr,
    errKinds: hasErr ? ERR_BITS.filter(([bit]) => ((rec[45] >> bit) & 1) === 0).map(([, n]) => n) : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-scene.test.js` then `npm test`
Expected: PASS, and the existing suite still passes.

- [ ] **Step 5: Commit**

```bash
git add device/shots.js device/ui/scene.js device/ui/format.js device/ui/shotview.js test/ui-scene.test.js
git commit -m "feat: UI scene grid, formatters and shot record view"
```

---

### Task 2: Instrument model

**Goal:** A virtual instrument that turns a pose (azimuth, inclination, distance) into stored shots, flags the third close shot as a leg, and can force `ACC ERR`.

**Files:**
- Modify: `device/x1.js` (`measure()` accepts `err` and `scan`)
- Create: `device/instrument.js`
- Test: `test/instrument.test.js`

**Acceptance Criteria:**
- [ ] `fire()` stores a shot built from `pose` and returns `{ index, leg, live }`, or `null` when nothing was stored
- [ ] The third consecutive close shot has the leg flag; the first two do not; a fourth close shot is also a leg; a different direction is not
- [ ] Azimuth closeness wraps around 360
- [ ] `forceErr` writes accuracy error bytes that `view()` reports as `absG`
- [ ] Scan shots carry the scan flag and are never legs; calibration shots are never legs
- [ ] `onLive` receives the live packet when the host port is open

**Verify:** `node --test test/instrument.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/instrument.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X1 } from '../device/x1.js';
import { Instrument } from '../device/instrument.js';
import { view } from '../device/ui/shotview.js';
import { FakeClock } from './helpers.js';

function make() {
  const clock = new FakeClock();
  const x1 = new X1({ now: clock.now });
  return { x1, inst: new Instrument(x1) };
}

test('fire stores a splay shot from the pose', () => {
  const { x1, inst } = make();
  inst.pose = { az: 120, inc: 10, dist: 4.5 };
  const r = inst.fire({});
  assert.equal(r.index, 0);
  assert.equal(r.leg, false);
  const v = view(x1.memory.shots[0]);
  assert.equal(v.isLeg, false);
  assert.equal(v.distance, 4.5);
  assert.ok(Math.abs(v.azimuth - 120) < 0.01);
  assert.ok(Math.abs(v.inclination - 10) < 0.01);
});

test('the third close shot is flagged as a leg, the first two are not', () => {
  const { x1, inst } = make();
  inst.pose = { az: 120, inc: 10, dist: 4.5 };
  const legs = [inst.fire({}).leg, inst.fire({}).leg, inst.fire({}).leg, inst.fire({}).leg];
  assert.deepEqual(legs, [false, false, true, true]);
  assert.equal(view(x1.memory.shots[1]).isLeg, false);
  assert.equal(view(x1.memory.shots[2]).isLeg, true);
  inst.pose = { az: 200, inc: 10, dist: 4.5 };
  assert.equal(inst.fire({}).leg, false);
});

test('azimuth closeness wraps around north', () => {
  const { inst } = make();
  inst.pose = { az: 359.5, inc: 0, dist: 3 };
  inst.fire({});
  inst.pose = { az: 0.4, inc: 0, dist: 3 };
  inst.fire({});
  inst.pose = { az: 0.5, inc: 0, dist: 3 };
  assert.equal(inst.fire({}).leg, true);
});

test('forceErr writes accuracy error bytes', () => {
  const { x1, inst } = make();
  inst.forceErr = true;
  inst.fire({});
  const v = view(x1.memory.shots[0]);
  assert.equal(v.hasErr, true);
  assert.deepEqual(v.errKinds, ['absG']);
});

test('scan and calibration shots are never legs', () => {
  const { x1, inst } = make();
  for (let i = 0; i < 3; i++) assert.equal(inst.fire({ scan: true }).leg, false);
  assert.equal(view(x1.memory.shots[0]).isScan, true);
  x1.cali = true;
  for (let i = 0; i < 3; i++) assert.equal(inst.fire({}).leg, false);
  assert.equal(view(x1.memory.shots[3]).isCali, true);
});

test('mark flag is stored', () => {
  const { x1, inst } = make();
  inst.fire({ flag: 0 });
  assert.equal(view(x1.memory.shots[0]).mark, 0);
});

test('fire returns null while the X1 cannot measure', () => {
  const { x1, inst } = make();
  x1.reboot();
  assert.equal(inst.fire({}), null);
  assert.equal(x1.memory.shots.length, 0);
});

test('onLive receives the live packet when the host port is open', () => {
  const { x1, inst } = make();
  x1.hostOpened();
  const got = [];
  inst.onLive = (p) => got.push(p);
  inst.fire({});
  assert.equal(got.length, 1);
  assert.equal(got[0][0], 0x01);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/instrument.test.js`
Expected: FAIL with `Cannot find module '../device/instrument.js'`

- [ ] **Step 3: Write the implementation**

Edit `device/x1.js`, in `measure()`: add `err = null, scan = false` to the destructured options and pass them to `encodeShot`:

```js
  measure({ splay = false, flag = Flag.none, distance = null, azimuth = null, inclination = null, err = null, scan = false } = {}) {
```

and in the `encodeShot({ ... })` call add `scan,` after `cali: this.cali,` and `err,` after `noise: Math.round(r() * 30),`:

```js
      cali: this.cali,
      scan,
      flag,
      ...
      noise: Math.round(r() * 30),
      err,
    });
```

Create `device/instrument.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/instrument.test.js` then `npm test`
Expected: PASS, existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add device/x1.js device/instrument.js test/instrument.test.js
git commit -m "feat: instrument model with leg detection and forced ACC ERR"
```

---

### Task 3: Ui core, power and home screen

**Goal:** The `Ui` class: button press/release with long-press and chord timing, power on/off, idle power-off, beeps, a screen registry, and the home (clock) screen.

**Files:**
- Create: `device/ui/settings.js`, `device/ui/ui.js`, `device/ui/screens/home.js`, `test/ui-helpers.js`
- Test: `test/ui-core.test.js`

**Acceptance Criteria:**
- [ ] The display is blank and ignores every button except `DIST` while off
- [ ] `DIST` powers on and shows the device date and time
- [ ] Holding `CLR` for 2 s powers off and clears `x1.laser` and `x1.cali`
- [ ] Idle power-off follows `settings.idleOff`; any button press resets the timer
- [ ] A long press fires once, at the threshold, and the release afterwards does nothing
- [ ] `DIST`+`M` held for 2 s dispatches a `'dist+m'` chord instead of two long presses
- [ ] `beep()` is silent when `settings.beep` is false

**Verify:** `node --test test/ui-core.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test and the test rig**

Create `test/ui-helpers.js`:

```js
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
```

Create `test/ui-core.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';

test('dark until DIST, then shows the device date and time', () => {
  const r = rig();
  r.tap('m');
  assert.equal(r.ui.on, false);
  assert.equal(r.text(), '');
  r.tap('dist');
  assert.equal(r.ui.on, true);
  const iso = new Date(r.x1.memory.clock() * 1000).toISOString();
  assert.match(r.text(), new RegExp(iso.slice(0, 10)));
  assert.match(r.text(), new RegExp(iso.slice(11, 19)));
  assert.equal(r.ui.backlight(), 10);
});

test('long CLR powers off and clears laser and calibration state', () => {
  const r = rig();
  r.tap('dist');
  r.x1.laser = true;
  r.x1.cali = true;
  r.tap('clr');
  assert.equal(r.ui.on, true, 'a short CLR does not power off');
  r.hold('clr', 2000);
  assert.equal(r.ui.on, false);
  assert.equal(r.x1.laser, false);
  assert.equal(r.x1.cali, false);
  assert.equal(r.ui.backlight(), 0);
});

test('idle power-off follows the setting and any press resets it', () => {
  const r = rig();
  r.tap('dist');
  r.run(50_000);
  r.tap('m');
  r.run(50_000);
  assert.equal(r.ui.on, true);
  r.run(11_000);
  assert.equal(r.ui.on, false);
});

test('a long press fires once and its release does nothing', () => {
  const r = rig();
  r.tap('dist');
  r.hold('dist', 2500);
  assert.equal(r.name(), 'HomeScreen');
});

test('DIST+M held together is a chord, not two long presses', () => {
  const r = rig();
  r.tap('dist');
  const seen = [];
  r.ui.screen.key = (ui, b, kind) => seen.push(`${b}:${kind}`);
  r.ui.press('dist');
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(seen, ['dist+m:chord']);
});

test('beep is silent when switched off', () => {
  const r = rig();
  r.ui.beep('short');
  r.ui.settings.beep = false;
  r.ui.beep('long');
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
  assert.deepEqual(r.ui.takeBeeps(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-core.test.js`
Expected: FAIL with `Cannot find module '../device/ui/ui.js'`

- [ ] **Step 3: Write the implementation**

Create `device/ui/settings.js`:

```js
// Settings the user changes in the menus. Defaults are the manual's bold values.
export const defaultUiSettings = () => ({
  ref: 'Rear',
  shotDelay: 0,
  backlight: 10,
  beep: true,
  idleOff: 60,
  errDetect: true,
  angleDiff: 0.4,
  absLim: 1.0,
  dipLim: 1.0,
  scanEnable: true,
  scanSpeed: 'Med.',
  scanTrigger: 'DIST+M',
  scanMinutes: 2,
  calErrDetect: true,
  grpLimit: 3,
  distUnit: 'm',
  angleUnit: 'deg',
  forcePair: false,
});
```

Create `device/ui/screens/home.js`:

```js
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
```

Create `device/ui/ui.js`:

```js
// The X1's front panel as a state machine: five buttons in, a scene out.
import { scene } from './scene.js';
import { defaultUiSettings } from './settings.js';
import { Instrument } from '../instrument.js';
import { HomeScreen } from './screens/home.js';

export const LONG_MS = 2000;

// Screen factories by name. Later tasks add their screens here.
export const SCREENS = {
  home: () => new HomeScreen(),
};

export class Ui {
  constructor({ x1, instrument = null, profile = 'stock-1.1.7' }) {
    this.x1 = x1;
    this.instrument = instrument ?? new Instrument(x1);
    this.profile = profile;
    this.settings = defaultUiSettings();
    this.on = false;
    this.screen = null;
    this.down = new Map(); // button -> { at, fired }
    this.beeps = [];
    this.sent = new Set(); // shot indices already transferred
    this.lastInput = x1.now();
  }

  now() { return this.x1.now(); }

  // ---- input ----------------------------------------------------------------
  press(b) {
    if (this.down.has(b)) return;
    this.lastInput = this.now();
    const entry = { at: this.now(), fired: false };
    this.down.set(b, entry);
    if (!this.on) {
      entry.fired = true; // nothing to do on release
      if (b === 'dist') this.powerOn();
    }
  }

  release(b) {
    const e = this.down.get(b);
    this.down.delete(b);
    if (!e || e.fired || !this.on) return;
    this.lastInput = this.now();
    this._dispatch(b, 'tap');
  }

  // Call about every 100 ms: long presses, chords, idle power-off, screen timers.
  tick() {
    if (!this.on) return;
    const t = this.now();
    const d = this.down.get('dist');
    const m = this.down.get('m');
    if (d && m && !d.fired && !m.fired && t - Math.max(d.at, m.at) >= LONG_MS) {
      d.fired = true;
      m.fired = true;
      this._dispatch('dist+m', 'chord');
    }
    for (const [b, e] of this.down) {
      if (this.on && !e.fired && t - e.at >= LONG_MS) {
        e.fired = true;
        this._dispatch(b, 'long');
      }
    }
    if (!this.on) return;
    if (t - this.lastInput >= this.settings.idleOff * 1000) { this.powerOff(); return; }
    this.screen?.tick?.(this, t);
  }

  _dispatch(b, kind) {
    if (b === 'clr' && kind === 'long') { this.powerOff(); return; }
    this.screen?.key?.(this, b, kind);
  }

  // ---- power ----------------------------------------------------------------
  powerOn() {
    this.on = true;
    this.x1.laser = false;
    this.open('home');
  }

  powerOff() {
    this.on = false;
    this.screen = null;
    this.x1.laser = false;
    this.x1.cali = false;
    this.down.clear();
  }

  // ---- screens --------------------------------------------------------------
  // open: a fresh screen (its enter() runs). resume: go back to a live one.
  open(name) { this.go(SCREENS[name]()); }
  go(screen) { this.screen = screen; screen.enter?.(this); }
  resume(screen) { this.screen = screen; }

  scene() {
    if (!this.on || !this.screen) return scene([]);
    return this.screen.render(this);
  }

  backlight() { return this.on ? this.settings.backlight : 0; }

  // ---- beeps and transfer flags ----------------------------------------------
  beep(kind) { if (this.settings.beep) this.beeps.push(kind); }
  takeBeeps() { const b = this.beeps; this.beeps = []; return b; }

  isUnsent(i) { return !this.sent.has(i); }
  clearUnsent() { for (let i = 0; i < this.x1.memory.shots.length; i++) this.sent.add(i); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-core.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add device/ui/settings.js device/ui/ui.js device/ui/screens/home.js test/ui-helpers.js test/ui-core.test.js
git commit -m "feat: Ui state machine with power, long press, chord and home screen"
```

---

### Task 4: Measure screen, marks and result pages

**Goal:** Pressing `DIST` arms the laser and shows live azimuth and inclination; the next `DIST` takes the shot; `M` cycles marks; long `DIST` takes a delayed shot; `<` `>` page through the result; `LEG` and `ACC ERR` show.

**Files:**
- Create: `device/ui/screens/measure.js`
- Modify: `device/ui/ui.js` (register `measure`; add `scan` and `menu` registration later in their tasks)
- Test: `test/ui-measure.test.js`

**Acceptance Criteria:**
- [ ] After power on, `DIST` shows `AZM`/`INCL` from the pose and `DIST ---- m`, and sets `x1.laser`
- [ ] Next `DIST` stores a shot, clears the laser, shows the distance, and beeps `short`
- [ ] `M` while armed cycles None, Feature, Ridge, Backsight, Generic, None and the shot stores that mark; the mark resets after each shot
- [ ] Long `DIST` with `shotDelay` N takes the shot N seconds later and shows `Shot in Ns`; a tap during the countdown cancels it
- [ ] Third close shot shows `LEG` and beeps `double`; a forced error shows `ACC ERR` and beeps `long`
- [ ] After a shot `>` and `<` page through the main page, error page and horizontal/vertical page, wrapping; `CLR` returns to home

**Verify:** `node --test test/ui-measure.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-measure.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { view } from '../device/ui/shotview.js';

const armed = (opts) => {
  const r = rig(opts);
  r.ui.instrument.pose = { az: 66.7, inc: 25, dist: 2.958 };
  r.tap('dist'); // power on
  r.tap('dist'); // laser on
  return r;
};

test('DIST arms the laser and shows the live pose', () => {
  const r = armed();
  assert.equal(r.x1.laser, true);
  assert.match(r.text(), /AZM +66\.7°/);
  assert.match(r.text(), /INCL +25\.0°/);
  assert.match(r.text(), /DIST +---- m/);
});

test('the next DIST takes the shot', () => {
  const r = armed();
  r.tap('dist');
  assert.equal(r.x1.laser, false);
  assert.equal(r.x1.memory.shots.length, 1);
  assert.match(r.text(), /DIST +2\.958 m/);
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
});

test('M cycles marks while armed and the shot keeps the mark', () => {
  const r = armed();
  r.tap('m');
  assert.match(r.text(), /Feature/);
  r.tap('m');
  r.tap('m');
  assert.match(r.text(), /Backsight/);
  r.tap('m');
  r.tap('m');
  assert.doesNotMatch(r.text(), /Generic|Backsight|Ridge|Feature/);
  r.tap('m'); // Feature again
  r.tap('dist');
  assert.equal(view(r.x1.memory.shots[0]).mark, 0);
  assert.match(r.text(), /Feature/);
  r.tap('dist'); // re-arm
  assert.doesNotMatch(r.text(), /Feature/, 'the mark resets after the shot');
});

test('long DIST takes a delayed shot and a tap cancels it', () => {
  const r = armed();
  r.ui.settings.shotDelay = 2;
  r.hold('dist', 2000);
  assert.match(r.text(), /Shot in 2s/);
  r.run(1900);
  assert.equal(r.x1.memory.shots.length, 0);
  r.run(200);
  assert.equal(r.x1.memory.shots.length, 1);

  const c = armed();
  c.ui.settings.shotDelay = 3;
  c.hold('dist', 2000);
  c.tap('dist');
  assert.doesNotMatch(c.text(), /Shot in/);
  c.run(5000);
  assert.equal(c.x1.memory.shots.length, 0);
});

test('long DIST with no delay shoots at once', () => {
  const r = armed();
  r.hold('dist', 2000);
  assert.equal(r.x1.memory.shots.length, 1);
});

test('third close shot shows LEG with a double beep', () => {
  const r = armed();
  for (let i = 0; i < 2; i++) { r.tap('dist'); r.tap('dist'); }
  r.ui.takeBeeps();
  r.tap('dist');
  assert.match(r.text(), /LEG/);
  assert.deepEqual(r.ui.takeBeeps(), ['short', 'double']);
});

test('forced error shows ACC ERR with a long beep', () => {
  const r = armed();
  r.ui.instrument.forceErr = true;
  r.tap('dist');
  assert.match(r.text(), /ACC ERR/);
  assert.deepEqual(r.ui.takeBeeps(), ['long']);
});

test('arrows page through the result and wrap', () => {
  const r = armed();
  r.ui.instrument.forceErr = true;
  r.tap('dist');
  r.tap('right');
  assert.match(r.text(), /Accuracy Error/);
  assert.match(r.text(), /absG error/);
  r.tap('right');
  assert.match(r.text(), /Horizontal +2\.681 m/);
  assert.match(r.text(), /Vertical +1\.250 m/);
  r.tap('right');
  assert.match(r.text(), /AZM/);
  r.tap('left');
  assert.match(r.text(), /Horizontal/);
});

test('CLR leaves measuring and switches the laser off', () => {
  const r = armed();
  r.tap('clr');
  assert.equal(r.x1.laser, false);
  assert.equal(r.name(), 'HomeScreen');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-measure.test.js`
Expected: FAIL (`SCREENS.measure is not a function`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/measure.js`:

```js
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
```

Edit `device/ui/ui.js`: add the import and registry entry:

```js
import { MeasureScreen } from './screens/measure.js';
```

```js
export const SCREENS = {
  home: () => new HomeScreen(),
  measure: () => new MeasureScreen(),
};
```

(`scan`, `memory`, `menu` and `clearUnsentFromMeasure` are registered by Tasks 5-7. Until then the tests in this task never reach them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-measure.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/measure.js device/ui/ui.js test/ui-measure.test.js
git commit -m "feat: measure screen with marks, delayed shot, leg and error display"
```

---

### Task 5: Memory mode

**Goal:** `<` or `>` opens memory mode: a newest-first list with `E`/`C`/`S` markers, unsent `*` and mark `_`, and a four-page detail view.

**Files:**
- Create: `device/ui/screens/memory.js`
- Modify: `device/ui/ui.js` (register `memory`)
- Test: `test/ui-memory.test.js`

**Acceptance Criteria:**
- [ ] The list shows the newest shot first as `flag dist az inc` plus `*` when unsent and `_` when it has a mark
- [ ] `E` marks a shot with an accuracy error, `C` a calibration shot, `S` a scan shot
- [ ] `<` moves toward newer, `>` toward older, clamped; the list scrolls to keep the cursor visible; the header shows the shot number
- [ ] `M` opens the detail view; `M` cycles four pages; `<` `>` change shot keeping the page; `CLR` goes back, then home
- [ ] An empty memory shows `No data`

**Verify:** `node --test test/ui-memory.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-memory.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';

// n shots, oldest first: dist 2+i, az 10+40i, inc i.
function seeded(n) {
  const r = rig();
  for (let i = 0; i < n; i++) {
    r.ui.instrument.pose = { az: 10 + i * 40, inc: i, dist: 2 + i };
    r.ui.instrument.fire({});
    r.clock.advance(1000);
  }
  r.tap('dist'); // power on
  r.tap('right'); // memory mode
  return r;
}

test('newest first, with the shot number and unsent marker', () => {
  const r = seeded(7);
  assert.equal(r.name(), 'MemoryScreen');
  assert.match(r.text(), /SHOT # 7/);
  assert.match(r.text(), /8\.00 +250\.0 +6\.0\*/);
  r.tap('right');
  assert.match(r.text(), /SHOT # 6/);
  r.tap('left');
  r.tap('left');
  assert.match(r.text(), /SHOT # 7/, 'clamped at the newest');
});

test('E, C and S markers and the mark underscore', () => {
  const r = rig();
  const inst = r.ui.instrument;
  inst.pose = { az: 90, inc: 2, dist: 4 };
  inst.forceErr = true; inst.fire({}); inst.forceErr = false;
  r.x1.cali = true; inst.pose = { az: 10, inc: 0, dist: 5 }; inst.fire({}); r.x1.cali = false;
  inst.pose = { az: 20, inc: 0, dist: 6 }; inst.fire({ scan: true });
  inst.pose = { az: 30, inc: 0, dist: 7 }; inst.fire({ flag: 0 });
  r.tap('dist');
  r.tap('right');
  const t = r.text();
  assert.match(t, /^E +4\.00/m);
  assert.match(t, /^C +5\.00/m);
  assert.match(t, /^S +6\.00/m);
  assert.match(t, /^ +7\.00 +30\.0 +0\.0\*_/m);
});

test('the list scrolls to keep the cursor visible', () => {
  const r = seeded(12);
  assert.match(r.text(), /13\.00/);
  for (let i = 0; i < 9; i++) r.tap('right');
  assert.match(r.text(), /SHOT # 3/);
  assert.match(r.text(), /4\.00/);
  assert.doesNotMatch(r.text(), /13\.00/);
});

test('detail pages cycle and arrows change shot', () => {
  const r = seeded(3);
  r.tap('m');
  assert.match(r.text(), /SHOT # 3/);
  assert.match(r.text(), /DIST: +4\.000 m/);
  r.tap('m');
  assert.match(r.text(), /Horizontal/);
  r.tap('m');
  assert.match(r.text(), /No error/);
  r.tap('m');
  assert.match(r.text(), /absG:/);
  assert.match(r.text(), /Mark: +None/);
  r.tap('right');
  assert.match(r.text(), /SHOT # 2/);
  assert.match(r.text(), /absG:/, 'page is kept');
  r.tap('m');
  assert.match(r.text(), /DIST: +3\.000 m/);
  r.tap('clr');
  assert.match(r.text(), /8\.00|4\.00/);
  r.tap('clr');
  assert.equal(r.name(), 'HomeScreen');
});

test('empty memory', () => {
  const r = rig();
  r.tap('dist');
  r.tap('left');
  assert.match(r.text(), /No data/);
  r.tap('m');
  assert.match(r.text(), /No data/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-memory.test.js`
Expected: FAIL (`SCREENS.memory is not a function`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/memory.js`:

```js
import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist, fmtDate, fmtTime } from '../format.js';
import { view, MARKS } from '../shotview.js';

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
    if (kind !== 'tap') return;
    const n = this._n(ui);
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
    if (n === 0) return scene(['SHOT #  -', '', '', 'No data']);
    return this.detail === null ? this._list(ui, n) : this._detail(ui, n);
  }

  _list(ui, n) {
    const s = ui.settings;
    const start = Math.max(0, this.cursor - (LIST_ROWS - 1));
    const rows = [`SHOT # ${n - this.cursor}`, 'DIST AZM°INCL°'];
    const bold = [];
    for (let p = start; p < Math.min(n, start + LIST_ROWS); p++) {
      const i = this._index(ui, p);
      const v = view(ui.x1.memory.shots[i]);
      const flag = v.hasErr ? 'E' : v.isCali ? 'C' : v.isScan ? 'S' : ' ';
      const tail = (ui.isUnsent(i) ? '*' : ' ') + (v.mark !== NONE ? '_' : ' ');
      const num = (x, d) => x.toFixed(d).padStart(5);
      if (v.isLeg && !v.isCali && !v.isScan) bold.push(rows.length);
      rows.push(`${flag} ${num(distIn(v.distance, s.distUnit), 2)} ${num(angIn(v.azimuth, s.angleUnit), 1)} ${num(angIn(v.inclination, s.angleUnit), 1)}${tail}`);
    }
    return scene(rows, { invert: [2 + (this.cursor - start)], bold });
  }

  _detail(ui, n) {
    const s = ui.settings;
    const i = this._index(ui, this.cursor);
    const v = view(ui.x1.memory.shots[i]);
    const head = lr(`SHOT # ${n - this.cursor}`, ui.isUnsent(i) ? '*' : '');
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
      ];
    }
    const rows = [head, ...body];
    while (rows.length < 6) rows.push('');
    return scene([...rows.slice(0, 6), ...foot]);
  }
}

const distIn = (m, unit) => (unit === 'ft' ? m * 3.28084 : m);
const angIn = (d, unit) => (unit === 'grad' ? (d * 400) / 360 : d);
```

Edit `device/ui/ui.js`: `import { MemoryScreen } from './screens/memory.js';` and add `memory: () => new MemoryScreen(),` to `SCREENS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-memory.test.js` then `npm test`
Expected: PASS. If the `S`/`C` rows are not at the line start, check that `flag` is a single character followed by a space.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/memory.js device/ui/ui.js test/ui-memory.test.js
git commit -m "feat: memory mode list and detail pages"
```

---

### Task 6: Menus, options, information, time and factory reset

**Goal:** `M` from home opens the main menu: Calibration (opens in Task 8), Clr. Unsent, Options, Information, Advan. Menu, with the settings in the manual.

**Files:**
- Create: `device/ui/screens/menu.js`
- Modify: `device/ui/ui.js` (register `menu`, `clearUnsentFromMeasure`)
- Test: `test/ui-menu.test.js`

**Acceptance Criteria:**
- [ ] Main menu lists the five entries with a `>` cursor; `<` `>` move (clamped), `M` enters, `CLR` goes back and keeps the cursor
- [ ] Options adjust with `M` and write `ui.settings`: Ref, Shot delay 0-9, Backlight 0-10, Beep, IdleOff 60-300
- [ ] Clr. Unsent asks for confirmation; `M` confirms (all current shots marked sent), `CLR` cancels
- [ ] Information shows hardware, firmware, BLE version, serial, battery, then calibration info from device memory, or `NO CALI INFORMATION`
- [ ] Advanced menu has the seven entries from the manual; Shot, Scan, Calibration option lists, Units and BLE adjust settings
- [ ] Time editor changes year to seconds with `<` `>`, `M` moves to the next field, `CLR` saves to the device clock
- [ ] Factory reset asks for confirmation, then resets shots, settings and sent flags, and returns home

**Verify:** `node --test test/ui-menu.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-menu.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { defaultUiSettings } from '../device/ui/settings.js';

const menu = () => { const r = rig(); r.tap('dist'); r.tap('m'); return r; };
const step = (r, n) => { for (let i = 0; i < n; i++) r.tap('right'); };

test('main menu lists the entries and moves the cursor', () => {
  const r = menu();
  for (const l of ['Calibration', 'Clr. Unsent', 'Options', 'Information', 'Advan. Menu']) assert.match(r.text(), new RegExp(l));
  assert.match(r.text(), /> Calibration/);
  step(r, 2);
  assert.match(r.text(), /> Options/);
  step(r, 10);
  assert.match(r.text(), /> Advan\. Menu/, 'clamped');
  r.tap('clr');
  assert.equal(r.name(), 'HomeScreen');
});

test('options adjust the settings and back keeps the cursor', () => {
  const r = menu();
  step(r, 2);
  r.tap('m');
  assert.match(r.text(), /> Ref\. +Rear/);
  r.tap('m');
  assert.match(r.text(), /Ref\. +Tail/);
  r.tap('right');
  r.tap('m');
  assert.equal(r.ui.settings.shotDelay, 1);
  assert.match(r.text(), /Shot delay: +1s/);
  step(r, 2);
  r.tap('m');
  assert.equal(r.ui.settings.beep, false);
  assert.match(r.text(), /Beep: +OFF/);
  r.tap('right');
  r.tap('m');
  assert.equal(r.ui.settings.idleOff, 120);
  r.tap('clr');
  assert.match(r.text(), /> Options/);
});

test('Clr. Unsent confirms or cancels', () => {
  const r = rig();
  r.ui.instrument.fire({});
  r.ui.instrument.pose = { az: 200, inc: 0, dist: 1 };
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('m');
  r.tap('right');
  r.tap('m');
  assert.match(r.text(), /Clear unsent/);
  assert.match(r.text(), /M:Confirm/);
  r.tap('clr');
  assert.equal(r.ui.sent.size, 0);
  assert.match(r.text(), /> Clr\. Unsent/);
  r.tap('m');
  r.tap('m');
  assert.equal(r.ui.sent.size, 2);
  r.tap('clr');
  r.tap('clr');
  r.tap('right');
  assert.doesNotMatch(r.text(), /\*/, 'no unsent markers left');
});

test('Information shows device and calibration pages', () => {
  const r = menu();
  step(r, 3);
  r.tap('m');
  assert.match(r.text(), /Firmware: 1\.1\.7/);
  assert.match(r.text(), /Serial: +1234/);
  r.tap('m');
  assert.match(r.text(), /Aver\. Err\.: +0\.21/);
  assert.match(r.text(), /Err stddev: +0\.09/);
  assert.match(r.text(), /Max Err\.: +0\.48/);
  assert.match(r.text(), /Dip: +61\.37/);
  r.tap('clr');
  assert.match(r.text(), /> Information/);
});

test('Information says so when the device has no calibration', () => {
  const r = menu();
  r.x1.memory.config.fill(0xff, 0x40, 0x50); // 0x9040 - 0x8000
  step(r, 3);
  r.tap('m');
  r.tap('m');
  assert.match(r.text(), /NO CALI INFORMATION/);
});

test('advanced menu entries and option lists', () => {
  const r = menu();
  step(r, 4);
  r.tap('m');
  for (const l of ['Shot Options', 'Scan Options', 'Cal. Options', 'Time', 'Units', 'BLE options', 'Factory reset']) {
    r.ui.screen.cursor = 0;
    assert.ok(r.ui.screen.items.some((i) => i.label === l), l);
  }
  r.tap('right');
  r.tap('m'); // Scan Options
  r.tap('right');
  r.tap('m');
  assert.equal(r.ui.settings.scanSpeed, 'High');
  r.tap('clr');
  r.tap('clr'); // back to advanced, cursor on Scan Options
  step(r, 3);
  r.tap('m'); // Units
  r.tap('m');
  assert.equal(r.ui.settings.distUnit, 'ft');
});

test('shot options can be reset to defaults', () => {
  const r = menu();
  step(r, 4);
  r.tap('m');
  r.tap('m'); // Shot Options
  r.tap('right');
  r.tap('m');
  assert.equal(r.ui.settings.angleDiff, 0.5);
  step(r, 3);
  r.tap('m');
  assert.equal(r.ui.settings.angleDiff, 0.4);
});

test('time editor saves to the device clock', () => {
  const r = menu();
  step(r, 4);
  r.tap('m');
  step(r, 3);
  r.tap('m');
  assert.match(r.text(), /Year:/);
  const before = new Date(r.x1.memory.clock() * 1000);
  r.tap('right'); // year + 1
  r.tap('m');
  r.tap('right'); // month + 1
  r.tap('clr');
  const after = new Date(r.x1.memory.clock() * 1000);
  const month = before.getUTCMonth() + 1;
  assert.equal(after.getUTCFullYear(), before.getUTCFullYear() + 1);
  assert.equal(after.getUTCMonth() + 1, month === 12 ? 1 : month + 1);
  assert.equal(after.getUTCDate(), before.getUTCDate());
  assert.equal(after.getUTCHours(), before.getUTCHours());
});

test('factory reset wipes shots and settings', () => {
  const r = rig();
  r.ui.instrument.fire({});
  r.tap('dist');
  r.ui.settings.shotDelay = 5;
  r.ui.sent.add(0);
  r.tap('m');
  step(r, 4);
  r.tap('m');
  step(r, 6);
  r.tap('m');
  assert.match(r.text(), /Factory reset/);
  r.tap('m');
  assert.equal(r.x1.memory.shots.length, 0);
  assert.deepEqual(r.ui.settings, defaultUiSettings());
  assert.equal(r.ui.sent.size, 0);
  assert.equal(r.name(), 'HomeScreen');
});

test('M after a shot opens the menu', () => {
  const r = rig();
  r.tap('dist'); r.tap('dist'); r.tap('dist');
  r.tap('m');
  assert.match(r.text(), /Calibration/);
});

test('long > on the measure screen asks to clear unsent shots', () => {
  const r = rig();
  r.tap('dist'); r.tap('dist');
  r.hold('right', 2000);
  assert.match(r.text(), /Clear unsent/);
  r.tap('clr');
  assert.match(r.text(), /AZM/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-menu.test.js`
Expected: FAIL (`SCREENS.menu is not a function`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/menu.js`:

```js
import { scene, lr } from '../scene.js';
import { fmtDate, fmtTime } from '../format.js';
import { defaultUiSettings } from '../settings.js';
import { ADDR } from '../../memory.js';

const FOOT = ['< >:Prev/Next', 'M:Enter'];
const FOOT_ADJ = ['< >:Prev/Next', 'M:Adjust CLR:Back'];
const ONOFF = (v) => (v ? 'ON' : 'OFF');
const nextOf = (values, cur) => values[(values.indexOf(cur) + 1) % values.length];

// A cycling setting: M steps to the next value.
const cyc = (label, key, values, fmt = String) => ({
  label,
  value: (ui) => fmt(ui.settings[key]),
  adjust: (ui) => { ui.settings[key] = nextOf(values, ui.settings[key]); },
});

// A list of items with a '>' cursor. Item: { label, value?(ui), adjust?(ui), enter?(ui, self), run?(ui, self) }.
export class ListScreen {
  constructor({ items, back, footer = FOOT }) {
    this.items = items;
    this.back = back;
    this.footer = footer;
    this.cursor = 0;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const last = this.items.length - 1;
    if (b === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (b === 'right') this.cursor = Math.min(last, this.cursor + 1);
    else if (b === 'm') {
      const it = this.items[this.cursor];
      if (it.adjust) it.adjust(ui);
      else if (it.enter) ui.go(it.enter(ui, this));
      else if (it.run) it.run(ui, this);
    } else if (b === 'clr') this.back(ui);
  }

  render(ui) {
    const start = Math.max(0, this.cursor - 4);
    const rows = [];
    for (let i = start; i < Math.min(this.items.length, start + 5); i++) {
      const it = this.items[i];
      const left = `${i === this.cursor ? '> ' : '  '}${it.label}`;
      rows.push(it.value ? lr(left, it.value(ui)) : left);
    }
    while (rows.length < 6) rows.push('');
    return scene([...rows, ...this.footer]);
  }
}

export class ConfirmScreen {
  constructor(lines, onYes, onNo) {
    this.lines = lines;
    this.onYes = onYes;
    this.onNo = onNo;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm') this.onYes(ui);
    else if (b === 'clr') this.onNo(ui);
  }

  render() {
    const rows = [...this.lines];
    while (rows.length < 6) rows.push('');
    return scene([...rows, 'M:Confirm', 'CLR:Cancel']);
  }
}

export const clearUnsentConfirm = (onDone) =>
  new ConfirmScreen(['', 'Clear unsent', ' Shots?'], (ui) => { ui.clearUnsent(); onDone(ui); }, onDone);

export function optionsMenu(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Ref.', 'ref', ['Rear', 'Tail', 'Tripod', 'Front', 'Custom']),
      cyc('Shot delay:', 'shotDelay', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (v) => `${v}s`),
      cyc('Backlight:', 'backlight', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      cyc('Beep:', 'beep', [true, false], ONOFF),
      cyc('IdleOff:', 'idleOff', [60, 120, 180, 240, 300], (v) => `${v}s`),
    ],
  });
}

const SHOT_DEFAULTS = ['errDetect', 'angleDiff', 'absLim', 'dipLim'];

function shotOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Err Detect:', 'errDetect', [true, false], ONOFF),
      cyc('Angle Diff:', 'angleDiff', [0.2, 0.3, 0.4, 0.5, 0.6, 1.0], (v) => `${v.toFixed(1)}°`),
      cyc('ABS Lim:', 'absLim', [0.5, 0.8, 1.0, 1.5, 2.0, 3.0], (v) => `${v.toFixed(1)}%`),
      cyc('dip Lim:', 'dipLim', [0.5, 0.8, 1.0, 1.5, 2.0, 3.0], (v) => `${v.toFixed(1)}°`),
      { label: 'Reset Default', run: (ui) => { const d = defaultUiSettings(); for (const k of SHOT_DEFAULTS) ui.settings[k] = d[k]; ui.beep('short'); } },
      { label: 'Reset Statistic', run: (ui) => ui.beep('short') },
    ],
  });
}

function scanOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Enable:', 'scanEnable', [true, false], ONOFF),
      cyc('Speed:', 'scanSpeed', ['Low', 'Med.', 'High']),
      cyc('Trigger:', 'scanTrigger', ['DIST+M', '>']),
      cyc('Scan:', 'scanMinutes', [1, 2, 5, 10], (v) => `${v} Min`),
    ],
  });
}

function calOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Err Detect:', 'calErrDetect', [true, false], ONOFF),
      cyc('Grp Limit:', 'grpLimit', [1, 3, 4, 5, 6, 8, 10], (v) => `${v}%`),
    ],
  });
}

function unitsMenu(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [cyc('Distance:', 'distUnit', ['m', 'ft']), cyc('Angle:', 'angleUnit', ['deg', 'grad'])],
  });
}

function bleMenu(back) {
  return new ListScreen({ back, footer: ['', 'M:Adjust CLR:Back'], items: [cyc('Force Pair:', 'forcePair', [false, true], ONOFF)] });
}

const TIME_LIMITS = [[2000, 2099], [1, 12], [1, 31], [0, 23], [0, 59], [0, 59]];
const TIME_NAMES = ['Year:', 'Month:', 'Day:', 'Hour:', 'Min:', 'Sec:'];

// '<' '>' adjust the value, M moves to the next field, CLR saves.
export class TimeScreen {
  constructor(back) { this.back = back; }

  enter(ui) {
    const d = new Date(ui.x1.memory.clock() * 1000);
    this.f = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
    this.at = 0;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const [lo, hi] = TIME_LIMITS[this.at];
    if (b === 'right') this.f[this.at] = this.f[this.at] >= hi ? lo : this.f[this.at] + 1;
    else if (b === 'left') this.f[this.at] = this.f[this.at] <= lo ? hi : this.f[this.at] - 1;
    else if (b === 'm') this.at = (this.at + 1) % 6;
    else if (b === 'clr') {
      const [y, mo, d, h, mi, s] = this.f;
      ui.x1.memory.setClock(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
      this.back(ui);
    }
  }

  render() {
    const rows = this.f.map((v, i) => lr(`${i === this.at ? '> ' : '  '}${TIME_NAMES[i]}`, String(v)));
    return scene([...rows, '< >:Adjust', 'M:Next CLR:Save']);
  }
}

// Two pages: device info, then calibration info read from device memory.
export class InfoScreen {
  constructor(back) { this.back = back; this.page = 0; }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm') this.page = (this.page + 1) % 2;
    else if (b === 'clr') this.back(ui);
  }

  render(ui) {
    if (this.page === 0) {
      const fw = ui.profile === 'stock-1.1.7' ? '1.1.7' : '1.1.7+proposed';
      return scene([
        'CAVWAY X1', `Hardware: 1.0`, `Firmware: ${fw}`, 'Ble ver.:0.4.0',
        `Serial:   ${String(ui.x1.memory.serial()).padStart(4, '0')}`, 'Battery: 4.00V', '', 'M:NEXT CLR:Back',
      ]);
    }
    const info = ui.x1.memory.read(ADDR.caliInfo, 16);
    if (info[0] !== 0x55) return scene(['', '', 'NO CALI INFORMATION', '', '', '', '', 'M:NEXT CLR:Back']);
    const t = (info[2] | (info[3] << 8) | (info[4] << 16) | (info[5] << 24)) >>> 0;
    const v = (at) => ((info[at] | (info[at + 1] << 8)) / 100).toFixed(2);
    return scene([
      'Sensor 1', lr('Time:', fmtDate(t)), lr('', fmtTime(t)),
      lr('Aver. Err.:', v(6)), lr('Err stddev:', v(8)), lr('Max Err.:', v(10)), lr('Dip:', v(12)), 'M:NEXT CLR:Back',
    ]);
  }
}

function advancedMenu(back) {
  return new ListScreen({
    back,
    items: [
      { label: 'Shot Options', enter: (ui, self) => shotOptions((u) => u.resume(self)) },
      { label: 'Scan Options', enter: (ui, self) => scanOptions((u) => u.resume(self)) },
      { label: 'Cal. Options', enter: (ui, self) => calOptions((u) => u.resume(self)) },
      { label: 'Time', enter: (ui, self) => new TimeScreen((u) => u.resume(self)) },
      { label: 'Units', enter: (ui, self) => unitsMenu((u) => u.resume(self)) },
      { label: 'BLE options', enter: (ui, self) => bleMenu((u) => u.resume(self)) },
      {
        label: 'Factory reset',
        enter: (ui, self) => new ConfirmScreen(
          ['', 'Factory reset', ' Erase all?'],
          (u) => { u.x1.factoryReset(); Object.assign(u.settings, defaultUiSettings()); u.sent.clear(); u.open('home'); },
          (u) => u.resume(self),
        ),
      },
    ],
  });
}

export function mainMenu() {
  return new ListScreen({
    back: (ui) => ui.open('home'),
    items: [
      { label: 'Calibration', enter: () => { throw new Error('Calibration screen arrives in Task 8'); } },
      { label: 'Clr. Unsent', enter: (ui, self) => clearUnsentConfirm((u) => u.resume(self)) },
      { label: 'Options', enter: (ui, self) => optionsMenu((u) => u.resume(self)) },
      { label: 'Information', enter: (ui, self) => new InfoScreen((u) => u.resume(self)) },
      { label: 'Advan. Menu', enter: (ui, self) => advancedMenu((u) => u.resume(self)) },
    ],
  });
}
```

The `Calibration` entry deliberately throws until Task 8 replaces that line. The Task 6 tests never press `M` on it, so they pass.

Edit `device/ui/ui.js`: import `{ mainMenu, clearUnsentConfirm }` from `./screens/menu.js` and add to `SCREENS`:

```js
  menu: () => mainMenu(),
  clearUnsentFromMeasure: () => clearUnsentConfirm((ui) => ui.open('measure')),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-menu.test.js` then `npm test`
Expected: PASS. If the time-editor test fails on a month or day rollover, check `TIME_LIMITS` and that `setClock` receives whole seconds.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/menu.js device/ui/ui.js test/ui-menu.test.js
git commit -m "feat: menus, options, information, time editor and factory reset"
```

---

### Task 7: Scan mode

**Goal:** Entering scan mode (chord `DIST`+`M`, or long `>`, per the setting) keeps the laser on and records a shot each time the pose has held still for a moment, until `CLR`, the time limit or 200 shots.

**Files:**
- Create: `device/ui/screens/scan.js`
- Modify: `device/ui/ui.js` (register `scan`)
- Test: `test/ui-scan.test.js`

**Acceptance Criteria:**
- [ ] `DIST`+`M` held 2 s while armed enters scan mode and shows `SCAN MODE` and a three-digit shot count
- [ ] A shot is recorded after the pose has been steady for the speed's settle time, once per distinct pose; scan shots carry the scan flag
- [ ] Changing the pose allows a new shot; `CLR`, the time limit, or 200 shots return to the measure screen armed
- [ ] With `scanTrigger` set to `>`, long `>` enters scan; with scan disabled the chord does nothing

**Verify:** `node --test test/ui-scan.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-scan.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { view } from '../device/ui/shotview.js';

const armed = () => { const r = rig(); r.tap('dist'); r.tap('dist'); return r; };
const chord = (r) => { r.ui.press('dist'); r.ui.press('m'); r.run(2000); r.ui.release('dist'); r.ui.release('m'); };

test('chord enters scan mode and shots follow a steady pose', () => {
  const r = armed();
  chord(r);
  assert.equal(r.name(), 'ScanScreen');
  assert.match(r.text(), /SCAN MODE/);
  assert.match(r.text(), /000 SHOTS/);
  r.run(800);
  assert.match(r.text(), /001 SHOTS/);
  assert.equal(view(r.x1.memory.shots[0]).isScan, true);
  r.run(5000);
  assert.match(r.text(), /001 SHOTS/, 'one shot per steady pose');
  r.ui.instrument.pose = { az: 90, inc: 0, dist: 2 };
  r.run(100);
  r.run(800);
  assert.match(r.text(), /002 SHOTS/);
  assert.equal(r.x1.laser, true);
});

test('CLR returns to the measure screen, armed', () => {
  const r = armed();
  chord(r);
  r.tap('clr');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true);
  assert.match(r.text(), /AZM/);
});

test('the time limit ends the scan', () => {
  const r = armed();
  r.ui.settings.scanMinutes = 1;
  chord(r);
  r.run(61_000);
  assert.equal(r.name(), 'MeasureScreen');
});

test("long '>' is the trigger when the setting says so", () => {
  const r = armed();
  r.ui.settings.scanTrigger = '>';
  r.hold('right', 2000);
  assert.equal(r.name(), 'ScanScreen');
});

test('scan disabled: the chord does nothing', () => {
  const r = armed();
  r.ui.settings.scanEnable = false;
  chord(r);
  assert.equal(r.name(), 'MeasureScreen');
});
```

Note on `chord()`: `armed()` leaves the measure screen armed, and `r.run(2000)` inside the chord also runs the idle timer; that is fine because the press resets it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-scan.test.js`
Expected: FAIL (`SCREENS.scan is not a function`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/scan.js`:

```js
import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist } from '../format.js';

// How long the pose must hold still before a scan shot (a guess).
const SETTLE_MS = { Low: 1200, 'Med.': 700, High: 300 };
const MAX_SHOTS = 200;

export class ScanScreen {
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
      if (ui.instrument.fire({ scan: true })) {
        this.count++;
        this.shotKey = k;
      }
      ui.x1.laser = true;
    }
    if (this.count >= MAX_SHOTS || t - this.start >= ui.settings.scanMinutes * 60_000) this.exit(ui);
  }

  exit(ui) {
    ui.x1.laser = false;
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
```

Edit `device/ui/ui.js`: `import { ScanScreen } from './screens/scan.js';` and add `scan: () => new ScanScreen(),` to `SCREENS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-scan.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/scan.js device/ui/ui.js test/ui-scan.test.js
git commit -m "feat: scan mode"
```

---

### Task 8: Calibration screens

**Goal:** Menu → Calibration: take groups of four shots, reset a group with `>`, compute a report once at least nine groups exist, apply or discard it, exit with `CLR`.

**Files:**
- Create: `device/ui/screens/calibration.js`
- Modify: `device/ui/screens/menu.js` (the Calibration entry), `device/ui/ui.js` (register `calibration`)
- Test: `test/ui-calibration.test.js`

**Acceptance Criteria:**
- [ ] Entering sets `x1.cali` and the laser; shots are stored as calibration shots and are never legs
- [ ] The screen shows `Group g` and `n / 4`; the fourth shot completes a group with a double beep; the next shot starts group g+1
- [ ] `>` clears the current group (undoing a just-completed one)
- [ ] `M` with fewer than nine completed groups only beeps; with nine or more it shows a report
- [ ] Report `M` applies: writes calibration info to device memory and shows `Updated`; `CLR` returns to the live calibration screen with its groups intact
- [ ] No more than 25 groups; `CLR` leaves calibration, clears `x1.cali` and returns home

**Verify:** `node --test test/ui-calibration.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-calibration.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { view } from '../device/ui/shotview.js';
import { ADDR } from '../device/memory.js';

const calib = () => { const r = rig(); r.tap('dist'); r.tap('m'); r.tap('m'); return r; };
const shots = (r, n) => { for (let i = 0; i < n; i++) r.tap('dist'); };

test('entering calibration sets the calibration state', () => {
  const r = calib();
  assert.equal(r.name(), 'CalibrationScreen');
  assert.equal(r.x1.cali, true);
  assert.equal(r.x1.laser, true);
  assert.match(r.text(), /Group 1/);
  assert.match(r.text(), /0 \/ 4/);
});

test('four shots complete a group; the next starts the next one', () => {
  const r = calib();
  shots(r, 3);
  assert.match(r.text(), /3 \/ 4/);
  r.ui.takeBeeps();
  shots(r, 1);
  assert.match(r.text(), /Group 1/);
  assert.match(r.text(), /4 \/ 4/);
  assert.deepEqual(r.ui.takeBeeps(), ['double']);
  shots(r, 1);
  assert.match(r.text(), /Group 2/);
  assert.match(r.text(), /1 \/ 4/);
  assert.ok(r.x1.memory.shots.every((s) => view(s).isCali && !view(s).isLeg));
});

test('> resets the current group, even a just-completed one', () => {
  const r = calib();
  shots(r, 2);
  r.tap('right');
  assert.match(r.text(), /0 \/ 4/);
  shots(r, 4);
  r.tap('right');
  assert.match(r.text(), /Group 1/);
  assert.match(r.text(), /0 \/ 4/);
});

test('M needs at least nine groups, then reports and applies', () => {
  const r = calib();
  shots(r, 32);
  r.ui.takeBeeps();
  r.tap('m');
  assert.equal(r.name(), 'CalibrationScreen');
  shots(r, 4);
  r.tap('m');
  assert.equal(r.name(), 'CalibrationReport');
  assert.match(r.text(), /Aver\. Error: +0\.25/);
  r.tap('m');
  assert.match(r.text(), /Updated/);
  const info = r.x1.memory.read(ADDR.caliInfo, 16);
  assert.equal(info[0], 0x55);
  assert.equal(info[6] | (info[7] << 8), 25);
  r.tap('clr');
  assert.equal(r.name(), 'CalibrationScreen');
  assert.match(r.text(), /Group 10/, 'groups kept after the report');
});

test('discarding the report keeps the old calibration', () => {
  const r = calib();
  const before = r.x1.memory.read(ADDR.caliInfo, 16);
  shots(r, 36);
  r.tap('m');
  r.tap('clr');
  assert.deepEqual(r.x1.memory.read(ADDR.caliInfo, 16), before);
});

test('at most 25 groups', () => {
  const r = calib();
  shots(r, 100);
  assert.equal(r.x1.memory.shots.length, 100);
  r.ui.takeBeeps();
  shots(r, 1);
  assert.equal(r.x1.memory.shots.length, 100);
  assert.deepEqual(r.ui.takeBeeps(), ['long']);
});

test('CLR leaves calibration', () => {
  const r = calib();
  r.tap('clr');
  assert.equal(r.x1.cali, false);
  assert.equal(r.x1.laser, false);
  assert.equal(r.name(), 'HomeScreen');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-calibration.test.js`
Expected: FAIL (`Calibration screen arrives in Task 8`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/calibration.js`:

```js
import { scene, lr } from '../scene.js';
import { fmtAngle } from '../format.js';
import { ADDR } from '../../memory.js';

const MAX_GROUPS = 25;
const MIN_GROUPS = 9; // "more than eight" complete groups

// The report is canned (taken from the manual's screenshot), not computed.
const REPORT = { avg: 25, stddev: 28, max: 128, dip: 5730 };

export class CalibrationScreen {
  enter(ui) {
    this.groups = 0; // completed groups
    this.inGroup = 0; // shots in the current group, 0..3
    this.done = false; // true right after a group completed, until the next shot
    ui.x1.cali = true;
    ui.x1.laser = true;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'dist') this._shoot(ui);
    else if (b === 'right') this._reset();
    else if (b === 'm') {
      if (this.groups >= MIN_GROUPS) ui.go(new CalibrationReport(this));
      else ui.beep('short');
    } else if (b === 'clr') {
      ui.x1.cali = false;
      ui.x1.laser = false;
      ui.open('home');
    }
  }

  _shoot(ui) {
    if (this.groups >= MAX_GROUPS) { ui.beep('long'); return; }
    this.done = false;
    const r = ui.instrument.fire({});
    ui.x1.laser = true;
    if (!r) return;
    this.inGroup++;
    if (this.inGroup === 4) {
      this.groups++;
      this.inGroup = 0;
      this.done = true;
      ui.beep('double');
    } else ui.beep('short');
  }

  _reset() {
    if (this.done) { this.groups--; this.done = false; }
    this.inGroup = 0;
  }

  render(ui) {
    const p = ui.instrument.pose;
    const g = this.done ? this.groups : this.groups + 1;
    const n = this.done ? 4 : this.inGroup;
    return scene(['', lr('AZM', fmtAngle(p.az)), lr('INCL', fmtAngle(p.inc)), `Group ${g}`, `${n} / 4`, '', '>:Reset Group', 'CLR:Exit']);
  }
}

export class CalibrationReport {
  constructor(parent) {
    this.parent = parent;
    this.applied = false;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm' && !this.applied) { this._apply(ui); this.applied = true; }
    else if (b === 'clr') ui.resume(this.parent);
  }

  _apply(ui) {
    const t = ui.x1.memory.clock();
    const info = new Uint8Array(16).fill(0xff);
    const put16 = (at, v) => { info[at] = v & 0xff; info[at + 1] = (v >> 8) & 0xff; };
    info[0] = 0x55;
    info[1] = 0x01;
    info.set([t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, t >>> 24], 2);
    put16(6, REPORT.avg);
    put16(8, REPORT.stddev);
    put16(10, REPORT.max);
    put16(12, REPORT.dip);
    ui.x1.memory.write(ADDR.caliInfo, info);
    ui.beep('short');
  }

  render() {
    if (this.applied) return scene(['', '', 'Calibration', '  Updated']);
    return scene([
      'Sensor 1', 'Aver. Error: 0.25°', 'Err Stddev: 0.28°', 'Max Err: 1.28°',
      'Iterations: 36', 'Magn. Dip: 57.30°', '<>:Scroll report', 'M:Apply CLR:Exit',
    ]);
  }
}
```

Edit `device/ui/screens/menu.js`: add `import { CalibrationScreen } from './calibration.js';` and replace the Calibration item:

```js
      { label: 'Calibration', enter: () => new CalibrationScreen() },
```

Edit `device/ui/ui.js`: nothing to register (calibration opens through the menu, not by name).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-calibration.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/calibration.js device/ui/screens/menu.js test/ui-calibration.test.js
git commit -m "feat: calibration group taking and report"
```

---

### Task 9: Panel front face

**Goal:** The panel shows the X1's screen on a canvas with five clickable buttons, keyboard shortcuts, pose inputs and a force-error switch. Shots taken on the face stream to the connected host like the existing Measure button.

**Files:**
- Create: `panel/keys.js`, `panel/face.js`
- Modify: `panel/panel.html`, `panel/panel.css`, `panel/panel.js`
- Test: `test/face-keys.test.js`

**Acceptance Criteria:**
- [ ] `KEYMAP` maps Space/Enter to `dist`, arrows to `left`/`right`, `m`/`M` to `m`, Escape/Backspace to `clr`
- [ ] The face draws the scene (inverse and bold rows honoured) and goes dark when off; backlight changes brightness
- [ ] Pointer down/up on a button, and key down/up, call `ui.press`/`ui.release`; holding works for long presses
- [ ] Editing the pose inputs changes `ui.instrument.pose`; the checkbox toggles `forceErr`
- [ ] A shot taken on the face reaches a connected flasher as a live packet
- [ ] Beeps appear as notes in the traffic log

**Verify:** `node --test test/face-keys.test.js` → pass, then the manual browser check in Step 5.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/face-keys.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP } from '../panel/keys.js';

test('keyboard map', () => {
  assert.equal(KEYMAP[' '], 'dist');
  assert.equal(KEYMAP.Enter, 'dist');
  assert.equal(KEYMAP.ArrowLeft, 'left');
  assert.equal(KEYMAP.ArrowRight, 'right');
  assert.equal(KEYMAP.m, 'm');
  assert.equal(KEYMAP.M, 'm');
  assert.equal(KEYMAP.Escape, 'clr');
  assert.equal(KEYMAP.Backspace, 'clr');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/face-keys.test.js`
Expected: FAIL with `Cannot find module '../panel/keys.js'`

- [ ] **Step 3: Write the implementation**

Create `panel/keys.js`:

```js
// Keyboard shortcuts for the X1's five buttons.
export const KEYMAP = {
  ' ': 'dist',
  Enter: 'dist',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  m: 'm',
  M: 'm',
  Escape: 'clr',
  Backspace: 'clr',
};
```

Create `panel/face.js`:

```js
// Draws the Ui scene on a canvas and forwards clicks and keys to it.
import { COLS, ROWS } from '../device/ui/scene.js';
import { KEYMAP } from './keys.js';

const CELL_W = 12;
const CELL_H = 32;
const BG = '#b7c98a';
const FG = '#1f2a10';

export function mountFace({ ui, canvas, root, note }) {
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = ui.on ? BG : '#1b1d1f';
    ctx.fillRect(0, 0, w, h);
    canvas.style.opacity = String(ui.on ? 0.4 + 0.6 * (ui.backlight() / 10) : 1);
    if (!ui.on) return;
    const s = ui.scene();
    ctx.textBaseline = 'middle';
    s.rows.forEach((row, i) => {
      const y = i * CELL_H;
      const inv = s.invert.includes(i);
      if (inv) { ctx.fillStyle = FG; ctx.fillRect(0, y, w, CELL_H); }
      ctx.fillStyle = inv ? BG : FG;
      ctx.font = `${s.bold.includes(i) ? 'bold ' : ''}20px ui-monospace, Menlo, monospace`;
      for (let c = 0; c < COLS; c++) if (row[c] !== ' ') ctx.fillText(row[c], c * CELL_W + 1, y + CELL_H / 2);
    });
  }

  // On-screen buttons: pointer down is press, up/leave/cancel is release.
  for (const el of root.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.press(b); draw(); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, () => { ui.release(b); draw(); });
    }
  }

  // Keyboard, unless the user is typing in a field.
  const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  window.addEventListener('keydown', (e) => {
    const b = KEYMAP[e.key];
    if (!b || e.repeat || typing()) return;
    e.preventDefault();
    ui.press(b);
    draw();
  });
  window.addEventListener('keyup', (e) => {
    const b = KEYMAP[e.key];
    if (!b || typing()) return;
    ui.release(b);
    draw();
  });

  // Pose and fault controls.
  const pose = ui.instrument.pose;
  for (const [id, key] of [['poseAz', 'az'], ['poseInc', 'inc'], ['poseDist', 'dist']]) {
    const el = root.querySelector(`#${id}`);
    el.value = pose[key];
    el.addEventListener('change', () => { pose[key] = Number(el.value) || 0; });
  }
  root.querySelector('#chkForceErr').addEventListener('change', (e) => { ui.instrument.forceErr = e.target.checked; });

  setInterval(() => {
    ui.tick();
    for (const b of ui.takeBeeps()) note(`Beep: ${b}`);
    draw();
  }, 100);
  draw();
}
```

Edit `panel/panel.html`: insert this section immediately before `<section class="card">` that contains the Firmware heading (the one with `<h2>Firmware</h2>`):

```html
<section class="card" id="face" aria-label="X1 front face">
  <h2>Front face</h2>
  <canvas id="lcd" class="lcd" aria-label="X1 display"></canvas>
  <div class="keys">
    <button data-btn="left" aria-label="Left">&lt;</button>
    <button data-btn="dist" class="dist">DIST</button>
    <button data-btn="right" aria-label="Right">&gt;</button>
    <button data-btn="m">M</button>
    <button data-btn="clr">CLR</button>
  </div>
  <p class="hint">Keys: Space = DIST, arrows, M, Esc = CLR. Hold DIST 2 s for a delayed shot.</p>
  <div class="grid3">
    <label>Azimuth °<input id="poseAz" type="number" step="0.1"></label>
    <label>Inclination °<input id="poseInc" type="number" step="0.1"></label>
    <label>Distance m<input id="poseDist" type="number" step="0.01" min="0"></label>
  </div>
  <label class="check"><input id="chkForceErr" type="checkbox"> Force ACC ERR on shots</label>
</section>
```

Append to `panel/panel.css`:

```css
.lcd { display: block; width: 100%; max-width: 252px; margin: 0 auto 8px; border: 2px solid #333; border-radius: 4px; }
.keys { display: flex; gap: 6px; justify-content: center; margin-bottom: 8px; }
.keys button { min-width: 44px; min-height: 36px; user-select: none; touch-action: none; }
.hint { font-size: 11px; opacity: 0.7; margin: 0 0 8px; }
```

Edit `panel/panel.js`: add imports at the top with the others:

```js
import { Ui } from '../device/ui/ui.js';
import { mountFace } from './face.js';
```

and after the `await attachHost(host, chrome);` / `if (saved.plugged) host.setPlugged(true);` lines add:

```js
// ---- front face ------------------------------------------------------------------
const ui = new Ui({ x1 });
ui.instrument.onLive = (packet) => host.sendUnsolicited(packet);
mountFace({ ui, canvas: $('lcd'), root: $('face'), note });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/face-keys.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Verify in the browser (manual)**

Run: `node dev/serve.mjs 8123` and open `http://localhost:8123/ext/panel/panel.html` (the dev server serves the panel with a `chrome.*` stub).

Check, in order:
1. The "Front face" card shows a dark screen. Click `DIST` (or press Space): the LCD lights and shows the date and time.
2. `DIST` again: `AZM`, `INCL` and `DIST ---- m`; the Laser LED turns on. Edit Azimuth to 120: the screen follows.
3. `DIST` again: a shot is stored ("shots stored" count goes up) and the distance shows; the traffic log notes `Beep: short`.
4. Press `M` with the laser on (arm first), the mark name appears; take a shot and press `>`: error/HV pages cycle.
5. From the home screen press `M`: the menu appears with a `>` cursor; open Options, change Beep, press `CLR` twice.
6. Hold `CLR` for 2 s: the screen goes dark.
7. Tick "Force ACC ERR", take a shot: `ACC ERR` shows and the beep note says `long`.

Expected: all seven behave as described. If keys do nothing, click the page body first (focus must not be in an input).

- [ ] **Step 6: Commit**

```bash
git add panel/keys.js panel/face.js panel/panel.html panel/panel.css panel/panel.js test/face-keys.test.js
git commit -m "feat: panel front face with canvas, buttons, keys and pose controls"
```

---

### Task 10: Documentation

**Goal:** README documents the front face and what is guessed.

**Files:**
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] README has a "Front face (UI model)" section: how to use it, key map, what is modelled, and a list of guessed values
- [ ] The section says phase 2 (BLE and the proposed profile) and phase 3 (real firmware check) are not built yet

**Verify:** `grep -n "Front face" README.md` → one heading found

**Steps:**

- [ ] **Step 1: Write the section**

Append to `README.md`:

```markdown
## Front face (UI model)

The panel's "Front face" card is a behavioral model of the X1's five buttons and
screen, written from the Rev C manual (firmware 1.1.6) and the 1.1.7 changelog.
Shots taken on it are stored in the emulated X1 and stream to a connected host
exactly like the Measure button.

Keys: Space = DIST, arrow keys = `<` `>`, M = M, Esc/Backspace = CLR. Hold DIST
2 s for a delayed shot (set the delay in Options), hold DIST+M or `>` (per the
Scan option) for scan mode, hold CLR 2 s to power off.

Modelled: power and idle off, laser and shot, marks, leg detection, `ACC ERR`,
result pages, memory mode, all menus in the manual, scan mode, on-device
calibration. Not modelled: the lock chord (CLR + `>`), the 1.1.7 shot menu
(delete shot, change mark), and persistence of UI settings across panel reloads.

Guessed, not measured: close-shot tolerances (2°, 2% distance), scan settle
times, the scan flag bit (bit 6 of the flag byte), the canned calibration
report, screen layout (a 21x8 text grid, not the real pixels). A later phase
will check these against the real firmware.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Front face" README.md && npm test`
Expected: one heading line, and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the front face and what is guessed"
```

---

## Self-review

**Spec coverage** (spec section, then task):
- UI model as pure state machine, button events, injected clock, scene, beeps, backlight: Task 3.
- Behaviors: power/idle off: T3; measure, delayed shot, marks, info pages: T4; memory mode and detail pages: T5; menu, Options, Information, Advanced (Shot/Scan/Cal/Time/Units/BLE/Factory reset): T6; scan mode and both triggers: T7; calibration group taking: T8; long `>` clear-unsent hotkey: T4+T6.
- Instrument model (pose sliders, shots, three-close-shot leg, ACC ERR injection): T2 and T9.
- Panel canvas, five buttons, keys, pose, profile: T9 (profile switch is stock-only in this phase, noted in scope).
- Renderer deviation (scene instead of 1-bit frame): recorded in the spec edit and the scope note.
- Gaps, stated as out of scope: lock chord, 1.1.7 shot menu screens, boot-mode screen for firmware upgrade, UI state persistence. The spec lists the lock chord and boot screen as behaviors; they are deferred here and noted in the README. BLE shim and proposed profile are phase 2; real-firmware check is phase 3.

**Placeholder scan:** The Task 6 `Calibration` entry throws until Task 8 replaces it, and the tests in between never reach it. No "TBD" or "implement later".

**Type consistency:** `Instrument.fire({ flag, scan })` returns `{ index, leg, live }` or `null` (T2), used in T4, T7, T8. `ui.open(name)`, `ui.go(screen)`, `ui.resume(screen)` defined in T3 and used consistently. `SCREENS` keys used: `home`, `measure`, `memory`, `menu`, `scan`, `clearUnsentFromMeasure`, each registered in a task before the first test that reaches it, except `memory`, `menu`, `scan` referenced inside `measure.js` (T4) but only reached in T5-T7 tests. `view()` fields (`isLeg`, `isCali`, `isScan`, `mark`, `distance`, `azimuth`, `inclination`, `hasErr`, `errKinds`, `time`, `absG`, `absM`, `dip`) match between T1 and later use. `ListScreen` item shape matches across T6.

**Not executed:** the code in this plan has not been run. Expect small fixes (regex whitespace, off-by-one in a scroll window) when the tests first run; fix the code or the test, not the intent.
