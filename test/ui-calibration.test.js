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
  assert.deepEqual(r.ui.takeBeeps(), ['short'], 'M below nine groups only beeps');
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
  assert.match(r.text(), /Group 9/, 'groups kept after the report');
  assert.match(r.text(), /4 \/ 4/);
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

test('a failed shot keeps a just-completed group', () => {
  const r = calib();
  shots(r, 4);
  r.x1.firmware.state = 'bootloader';
  shots(r, 1);
  assert.match(r.text(), /Group 1/);
  assert.match(r.text(), /4 \/ 4/);
});
