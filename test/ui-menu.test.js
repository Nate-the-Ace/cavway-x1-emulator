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
  r.x1.memory.config.fill(0xff, 0x1040, 0x1050); // 0x9040 - 0x8000
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
