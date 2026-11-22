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
  r.ui.settings.idleOff = 120; // idle power-off (60 s) would otherwise win the tie at 62 s
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
