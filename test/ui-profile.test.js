import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED, STOCK } from '../device/ui/profile.js';

const watch = (r) => {
  const seen = [];
  r.ui.screen.key = (ui, b, kind) => seen.push(`${b}:${kind}`);
  return seen;
};

test('stock: M is a tap until 2 s', () => {
  const r = rig();
  r.tap('dist');
  r.hold('m', 1200);
  assert.match(r.text(), /Calibration/);
});

test('proposed: M is a long press after 1 s and does not open the menu', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('m');
  r.run(900);
  assert.deepEqual(seen, []);
  r.run(200);
  assert.deepEqual(seen, ['m:long']);
  r.ui.release('m');
  assert.deepEqual(seen, ['m:long'], 'no tap after the long press');
});

test('proposed: CLR and DIST long presses are still 2 s', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  r.hold('clr', 1100);
  assert.equal(r.ui.on, true);
  r.hold('clr', 2000);
  assert.equal(r.ui.on, false);
});

test('proposed: DIST+M still chords at 2 s without a stray M long press', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('dist');
  r.run(300);
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(seen, ['dist+m:chord']);
});

test('a screen can own long CLR', () => {
  const r = rig();
  r.tap('dist');
  r.ui.screen.handlesLongClr = true;
  const seen = watch(r);
  r.hold('clr', 2100);
  assert.deepEqual(seen, ['clr:long']);
  assert.equal(r.ui.on, true);
});

test('both arrows together are one left+right tap', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('left');
  r.ui.press('right');
  r.run(100);
  r.ui.release('left');
  r.ui.release('right');
  assert.deepEqual(seen, ['left+right:tap']);
});

test('both arrows held 2 s are one left+right long press', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('left');
  r.run(200);
  r.ui.press('right');
  r.run(2100);
  r.ui.release('right');
  r.ui.release('left');
  assert.deepEqual(seen, ['left+right:long']);
});

test('separate arrow taps are unchanged', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.tap('left');
  r.tap('right');
  r.hold('right', 2100);
  assert.deepEqual(seen, ['left:tap', 'right:tap', 'right:long']);
});

test('onInput reports every dispatched input', () => {
  const r = rig();
  const events = [];
  r.ui.onInput = (e) => events.push(e);
  r.tap('dist'); // power on
  r.tap('right');
  r.hold('right', 2100);
  r.ui.press('dist');
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(events.map((e) => [e.button, e.kind, e.screen]), [
    ['dist', 'tap', 'off'],
    ['right', 'tap', 'HomeScreen'],
    ['right', 'long', 'MemoryScreen'],
    ['dist+m', 'chord', 'MemoryScreen'],
  ]);
  assert.equal(events[2].heldMs >= 2000, true);
  assert.equal(typeof events[0].t, 'number');
});

test('setProfile powers off and clears annotations; resetState clears them too', () => {
  const r = rig();
  r.tap('dist');
  r.ui.annotations.setTag(0, 5);
  r.ui.annotations.setName(0, 'A1');
  r.ui.setProfile(PROPOSED);
  assert.equal(r.ui.profile, PROPOSED);
  assert.equal(r.ui.proposed, true);
  assert.equal(r.ui.on, false);
  assert.equal(r.ui.annotations.tags.size, 0);
  r.ui.annotations.setTag(1, 5);
  r.ui.resetState();
  assert.equal(r.ui.annotations.tags.size, 0);
  r.ui.setProfile(STOCK);
  assert.equal(r.ui.proposed, false);
});

test('content defaults to the default callouts and can be replaced', () => {
  const r = rig();
  assert.equal(r.ui.content.callouts.length, 6);
  const custom = { callouts: [{ name: 'X', items: ['a'] }], namePrefix: 'Q', nameFirst: 7 };
  const r2 = rig({ ui: { content: custom } });
  assert.equal(r2.ui.content.namePrefix, 'Q');
});
