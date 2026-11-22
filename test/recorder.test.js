import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputRecorder, presses } from '../device/ui/recorder.js';
import { rig } from './ui-helpers.js';

const ev = (button, kind, heldMs = 0, screen = 'X', t = 0) => ({ t, button, kind, heldMs, screen });

test('counts by kind and sums hold time', () => {
  const r = new InputRecorder();
  r.record(ev('dist', 'tap'));
  r.record(ev('m', 'tap'));
  r.record(ev('m', 'long', 1000));
  r.record(ev('dist+m', 'chord', 2100));
  r.record(ev('left+right', 'tap', 50));
  r.record(ev('left+right', 'long', 2000));
  const t = r.totals();
  assert.equal(t.taps, 2);
  assert.equal(t.longs, 1);
  assert.equal(t.chords, 3);
  assert.equal(t.holdMs, 1000 + 2100 + 2000);
  assert.equal(t.presses, 2 + 1 + 2 * 3);
  assert.equal(presses(t), t.presses);
});

test('tasks split the counts', () => {
  const r = new InputRecorder();
  r.task('First');
  r.record(ev('dist', 'tap'));
  r.record(ev('dist', 'tap'));
  r.task('Second');
  r.record(ev('m', 'long', 1000));
  assert.deepEqual(r.tasks.map((t) => [t.name, t.taps, t.longs]), [['First', 2, 0], ['Second', 0, 1]]);
  assert.equal(r.totals().taps, 2);
});

test('the first task() renames the empty starting bucket', () => {
  const r = new InputRecorder();
  r.task('Only');
  assert.deepEqual(r.tasks.map((t) => t.name), ['Only']);
  r.record(ev('dist', 'tap'));
  r.task('Next');
  assert.deepEqual(r.tasks.map((t) => t.name), ['Only', 'Next']);
});

test('reset and the log limit', () => {
  const r = new InputRecorder({ maxLog: 3 });
  for (let i = 0; i < 5; i++) r.record(ev('dist', 'tap', 0, 'X', i));
  assert.equal(r.events.length, 3);
  assert.equal(r.events[0].t, 2);
  assert.equal(r.totals().taps, 5, 'counts are not limited by the log');
  r.reset();
  assert.equal(r.totals().taps, 0);
  assert.equal(r.events.length, 0);
});

test('toText summarizes', () => {
  const r = new InputRecorder();
  r.task('Tag features');
  r.record(ev('dist', 'tap', 0, 'HomeScreen', 1000));
  r.record(ev('m', 'long', 1000, 'MeasureScreen', 2500));
  const text = r.toText();
  assert.match(text, /Presses: 2 \(taps 1, long 1, chords 0\)/);
  assert.match(text, /Hold: 1\.0 s/);
  assert.match(text, /Tag features: 2 presses/);
  assert.match(text, /long m +MeasureScreen/);
});

test('recording real presses through Ui.onInput', () => {
  const t = rig();
  const rec = new InputRecorder();
  t.ui.onInput = (e) => rec.record(e);
  t.tap('dist');
  t.tap('dist');
  t.hold('right', 2100);
  assert.equal(rec.totals().taps, 2);
  assert.equal(rec.totals().longs, 1);
  assert.equal(rec.events[0].screen, 'off');
  assert.equal(rec.events[1].screen, 'HomeScreen');
});
