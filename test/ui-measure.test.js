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
