import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';
import { view } from '../device/ui/shotview.js';

const prop = () => rig({ ui: { profile: PROPOSED } });
const shoot = (r) => { r.tap('dist'); r.tap('dist'); r.tap('dist'); }; // wake, arm, take (first shot)
const again = (r) => { r.tap('dist'); r.tap('dist'); }; // arm, take (later shots)

test('stock: long M does nothing special', () => {
  const r = rig();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MeasureScreen');
  r.tap('dist');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MeasureScreen');
});

test('armed: long M opens the picker; the pick tags the next shot', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 1000);
  assert.equal(r.name(), 'PickerScreen');
  r.tap('m'); // Water
  r.tap('m'); // Drip
  assert.equal(r.name(), 'MeasureScreen');
  assert.match(r.text(), /Tag: Drip/);
  r.tap('dist'); // take
  assert.equal(r.ui.annotations.tag(0), 1);
  assert.match(r.text(), /Tag: Drip/);
  r.tap('dist'); // arm again
  assert.doesNotMatch(r.text(), /Tag:/, 'the pending tag cleared');
});

test('armed: cancelling the picker keeps the measure screen armed', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 1000);
  r.tap('clr');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true);
  assert.doesNotMatch(r.text(), /Tag:/);
});

test('after a shot: the shot menu, Name with the suggested next name', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  assert.equal(r.name(), 'ListScreen');
  for (const l of ['Callout', 'Name', 'Mark', 'Delete shot']) assert.match(r.text(), new RegExp(l));
  assert.match(r.text(), /> Callout/);
  r.tap('right');
  r.tap('m');
  assert.match(r.text(), /S1\[0\]/);
  r.tap('dist');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.ui.annotations.name(0), 'S1');
  assert.match(r.text(), /Stn: S1/);
  again(r);
  r.hold('m', 1000);
  r.tap('right');
  r.tap('m');
  assert.match(r.text(), /S2\[0\]/, 'the next name follows the last one');
  r.tap('dist');
  assert.equal(r.ui.annotations.name(1), 'S2');
});

test('after a shot: Callout tags that shot; cancel returns to the shot menu', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  r.tap('m'); // Callout
  assert.equal(r.name(), 'PickerScreen');
  r.tap('clr');
  assert.equal(r.name(), 'ListScreen');
  assert.match(r.text(), /> Callout/);
  r.tap('m');
  r.tap('right'); // Calcite
  r.tap('m');
  r.tap('m'); // Stalag
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.ui.annotations.tag(0), 9);
  assert.match(r.text(), /Tag: Stalag/);
});

test('shot menu: Mark cycles the stored mark', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  r.tap('right'); r.tap('right');
  assert.match(r.text(), /> Mark +None/);
  r.tap('m');
  assert.match(r.text(), /> Mark +Feature/);
  assert.equal(view(r.x1.memory.shots[0]).mark, 0);
});

test('shot menu: Delete shot only for the last shot, with confirmation', () => {
  const r = prop();
  shoot(r);
  again(r);
  r.ui.annotations.setName(1, 'S2');
  r.hold('m', 1000);
  for (let i = 0; i < 3; i++) r.tap('right');
  assert.match(r.text(), /> Delete shot/);
  r.tap('m');
  assert.match(r.text(), /Delete shot\?/);
  r.tap('clr');
  assert.match(r.text(), /> Delete shot/, 'cancel returns to the menu');
  r.tap('m');
  r.tap('m');
  assert.equal(r.x1.memory.shots.length, 1);
  assert.equal(r.ui.annotations.name(1), '');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true, 're-armed');
});

test('memory mode: long M opens the shot menu for the shot under the cursor', () => {
  const r = prop();
  r.ui.instrument.pose = { az: 10, inc: 0, dist: 2 };
  r.ui.instrument.fire({});
  r.ui.instrument.pose = { az: 200, inc: 0, dist: 3 };
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('right'); // memory mode, newest shot (index 1)
  r.tap('right'); // cursor on index 0
  r.hold('m', 1000);
  assert.equal(r.name(), 'ListScreen');
  assert.doesNotMatch(r.text(), /Delete shot/, 'not the last shot');
  r.tap('right');
  r.tap('m');
  r.tap('dist'); // accept S1 for shot index 0
  assert.equal(r.name(), 'MemoryScreen');
  assert.equal(r.ui.annotations.name(0), 'S1');
  assert.match(r.text(), /SHOT # 1 +S1/);
});

test('memory mode: tagged shots show an underscore and the tag on the last detail page', () => {
  const r = prop();
  r.ui.instrument.fire({});
  r.ui.annotations.setTag(0, 1);
  r.tap('dist');
  r.tap('right');
  assert.match(r.text(), /\*_/);
  r.tap('m');
  r.tap('m'); r.tap('m'); r.tap('m');
  assert.match(r.text(), /Tag: +Drip/);
});

test('stock memory mode: long M does nothing', () => {
  const r = rig();
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('right');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MemoryScreen');
});

test('Delete shot is refused when another shot appeared while the menu was open', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  for (let i = 0; i < 3; i++) r.tap('right');
  assert.match(r.text(), /> Delete shot/);
  r.ui.instrument.fire({}); // e.g. a host trigger
  r.ui.annotations.setName(0, 'KEEP');
  r.tap('m');
  r.tap('m'); // confirm
  assert.equal(r.x1.memory.shots.length, 2, 'nothing was deleted');
  assert.equal(r.ui.annotations.name(0), 'KEEP');
  assert.deepEqual(r.ui.takeBeeps().slice(-1), ['long']);
});

test('picking a callout cancels a pending delayed shot', () => {
  const r = prop();
  r.ui.settings.shotDelay = 2;
  r.tap('dist'); r.tap('dist');
  r.hold('dist', 2000);
  assert.match(r.text(), /Shot in 2s/);
  r.hold('m', 1000);
  r.tap('m'); r.tap('m');
  r.run(5000);
  assert.equal(r.x1.memory.shots.length, 0, 'the countdown was cancelled');
  assert.match(r.text(), /Tag: Drip/);
});

test('the pending tag stays visible during a delayed-shot countdown', () => {
  const r = prop();
  r.ui.settings.shotDelay = 2;
  r.tap('dist'); r.tap('dist');
  r.hold('m', 1000);
  r.tap('m'); r.tap('m');
  r.hold('dist', 2000);
  assert.match(r.text(), /Tag: Drip/);
  assert.match(r.text(), /Shot in 2s/);
});
