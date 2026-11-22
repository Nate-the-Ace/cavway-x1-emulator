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

test('memory shrinking under the screen does not break it', () => {
  const r = seeded(5);
  for (let i = 0; i < 4; i++) r.tap('right');
  r.tap('m');
  r.x1.memory.shots = [];
  assert.match(r.text(), /No data/);
  r.ui.instrument.fire({});
  assert.match(r.text(), /SHOT # 1/);
  r.tap('m');
  assert.match(r.text(), /absG:|DIST:|Horizontal|No error/);
});

test('long distances keep the unsent marker on screen', () => {
  const r = rig();
  r.ui.instrument.pose = { az: 123, inc: 4, dist: 112.5 };
  r.ui.instrument.fire({ flag: 0 });
  r.tap('dist');
  r.tap('right');
  assert.match(r.text(), /112\.5 +123\.0 +4\.0\*_/);
});
