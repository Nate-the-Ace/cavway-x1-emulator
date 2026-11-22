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
  assert.equal(lr('L', 'y'.repeat(30)), 'y'.repeat(COLS), 'over-long right text is clipped to the grid');
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
