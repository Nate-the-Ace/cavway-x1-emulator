import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';

const prop = () => rig({ ui: { profile: PROPOSED } });
const both = (r) => { r.ui.press('left'); r.ui.press('right'); r.run(50); r.ui.release('left'); r.ui.release('right'); };

test('stock: B does nothing on the measure screen', () => {
  const r = rig();
  r.tap('dist'); r.tap('dist');
  both(r);
  assert.equal(r.name(), 'MeasureScreen');
});

test('proposed, armed: B opens the picker and the pick tags the next shot', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  both(r);
  assert.equal(r.name(), 'PickerScreen');
  r.tap('right'); r.tap('right'); r.tap('m'); // Drip
  assert.equal(r.name(), 'MeasureScreen');
  assert.match(r.text(), /Tag: Drip/);
  r.tap('dist');
  assert.equal(r.ui.annotations.tag(0), 3);
});

test('proposed, after a shot: B opens the picker straight away and tags that shot', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist'); r.tap('dist');
  both(r);
  assert.equal(r.name(), 'PickerScreen');
  r.tap('right'); r.tap('m'); // Squeeze
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.ui.annotations.tag(0), 2);
  assert.match(r.text(), /Tag: Squeeze/);
});

test('proposed: CLR cancels the picker and the measure screen is as it was', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  both(r);
  r.tap('clr');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true);
  assert.doesNotMatch(r.text(), /Tag:/);
});

test('proposed, memory mode: B tags the shot under the cursor', () => {
  const r = prop();
  r.ui.instrument.pose = { az: 10, inc: 0, dist: 2 };
  r.ui.instrument.fire({});
  r.ui.instrument.pose = { az: 200, inc: 0, dist: 3 };
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('right'); // memory mode, newest shot
  r.tap('right'); // older shot (index 0)
  both(r);
  assert.equal(r.name(), 'PickerScreen');
  r.tap('right'); r.tap('right'); r.tap('m'); // Drip
  assert.equal(r.name(), 'MemoryScreen');
  assert.equal(r.ui.annotations.tag(0), 3);
  assert.equal(r.ui.annotations.tag(1), 0);
});

test('proposed, memory mode with no shots: B does nothing', () => {
  const r = prop();
  r.tap('dist');
  r.tap('right');
  both(r);
  assert.equal(r.name(), 'MemoryScreen');
});

test('a long press of both arrows does not open the picker', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  r.ui.press('left'); r.ui.press('right');
  r.run(2100);
  r.ui.release('left'); r.ui.release('right');
  assert.equal(r.name(), 'MeasureScreen');
});
