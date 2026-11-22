import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X1 } from '../device/x1.js';
import { Instrument } from '../device/instrument.js';
import { view } from '../device/ui/shotview.js';
import { SHOT_CAPACITY } from '../device/memory.js';
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

test('inclination and distance each break a run of close shots', () => {
  const { inst } = make();
  inst.pose = { az: 120, inc: 10, dist: 4.5 };
  inst.fire({});
  inst.fire({});
  inst.pose = { az: 120, inc: 14, dist: 4.5 };
  assert.equal(inst.fire({}).leg, false, 'inclination 4 degrees away');
  inst.pose = { az: 120, inc: 14, dist: 4.5 };
  inst.fire({});
  inst.pose = { az: 120, inc: 14, dist: 6 };
  assert.equal(inst.fire({}).leg, false, 'distance 1.5 m away');
});

test('shots are clean when forceErr is off', () => {
  const { x1, inst } = make();
  inst.fire({});
  assert.equal(view(x1.memory.shots[0]).hasErr, false);
});

test('a scan or calibration shot after two close splays is not a leg', () => {
  const a = make();
  a.inst.fire({});
  a.inst.fire({});
  assert.equal(a.inst.fire({ scan: true }).leg, false);
  const b = make();
  b.inst.fire({});
  b.inst.fire({});
  b.x1.cali = true;
  assert.equal(b.inst.fire({}).leg, false);
});

test('fire returns null when memory is full', () => {
  const { x1, inst } = make();
  for (let i = 0; i < SHOT_CAPACITY; i++) inst.fire({});
  assert.equal(x1.memory.shots.length, SHOT_CAPACITY);
  assert.equal(inst.fire({}), null);
  assert.equal(x1.memory.shots.length, SHOT_CAPACITY);
});
