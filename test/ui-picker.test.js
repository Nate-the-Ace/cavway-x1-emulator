import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';
import { PickerScreen } from '../device/ui/screens/picker.js';
import { NameEditScreen } from '../device/ui/screens/nameedit.js';
import { parseCallouts } from '../device/ui/callouts.js';

function picker(r) {
  const out = { picked: [], cancelled: 0 };
  r.tap('dist');
  r.ui.go(new PickerScreen({ onPick: (u, c) => out.picked.push(c), onCancel: () => { out.cancelled++; } }));
  return out;
}

const withItems = (text) => ({ callouts: parseCallouts(text).items, namePrefix: 'S', nameFirst: 1 });

test('the picker is one flat list; > moves down, M picks by position', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  assert.match(r.text(), /CALLOUT/);
  assert.match(r.text(), /> Lead/);
  assert.match(r.text(), /Squeeze/);
  assert.match(r.text(), /< >:Move M:Select/);
  assert.match(r.text(), /CLR:Cancel/);
  assert.doesNotMatch(r.text(), /Recent|Water/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /> Drip/);
  r.ui.takeBeeps();
  r.tap('m');
  assert.deepEqual(out.picked, [3]);
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
});

test('CLR cancels', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  r.tap('right');
  r.tap('clr');
  assert.equal(out.cancelled, 1);
  assert.deepEqual(out.picked, []);
});

test('movement clamps at both ends', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  picker(r);
  r.tap('left');
  assert.match(r.text(), /> Lead/);
  for (let i = 0; i < 30; i++) r.tap('right');
  assert.match(r.text(), /> Hazard/);
});

test('the list scrolls past five rows to the last item and back up', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  assert.doesNotMatch(r.text(), /Sump/, 'only five rows visible');
  for (let i = 0; i < 15; i++) r.tap('right');
  assert.match(r.text(), /> Hazard/);
  assert.match(r.text(), /Bones/);
  assert.doesNotMatch(r.text(), /Lead/);
  for (let i = 0; i < 15; i++) r.tap('left');
  assert.match(r.text(), /> Lead/);
  assert.match(r.text(), /Pool/);
  assert.doesNotMatch(r.text(), /Hazard/);
  for (let i = 0; i < 15; i++) r.tap('right');
  r.tap('m');
  assert.deepEqual(out.picked, [16]);
});

test('an empty list shows No callouts and M does nothing', () => {
  const r = rig({ ui: { profile: PROPOSED, content: withItems('x') } });
  const out = picker(r);
  r.ui.content = { callouts: [], namePrefix: 'S', nameFirst: 1 };
  assert.match(r.text(), /No callouts/);
  r.tap('right');
  r.tap('m');
  assert.deepEqual(out.picked, []);
  r.tap('clr');
  assert.equal(out.cancelled, 1);
});

function nameEditor(r, initial = 'S1') {
  const out = { done: [], cancelled: 0 };
  r.tap('dist');
  r.ui.go(new NameEditScreen({ initial, onDone: (u, n) => out.done.push(n), onCancel: () => { out.cancelled++; } }));
  return out;
}

test('name editor: backspace, scroll, add, finish with DIST', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'S1');
  assert.match(r.text(), /S1\[0\]/);
  r.tap('clr');
  assert.match(r.text(), /\sS\[0\]/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /S\[2\]/);
  r.tap('m');
  assert.match(r.text(), /S2\[0\]/, 'the scroller returns to 0');
  r.tap('dist');
  assert.deepEqual(out.done, ['S2']);
});

test('name editor: the scroll wraps through OK, and M on OK finishes', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'AB');
  r.tap('left');
  assert.match(r.text(), /\[OK\]/);
  r.tap('left');
  assert.match(r.text(), /\[\.\]/);
  r.tap('right');
  r.tap('m');
  assert.deepEqual(out.done, ['AB']);
});

test('name editor: CLR on an empty name cancels; long CLR cancels without powering off', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'S');
  r.tap('clr');
  assert.equal(out.cancelled, 0, 'S deleted, name empty');
  r.tap('clr');
  assert.equal(out.cancelled, 1);
  const r2 = rig({ ui: { profile: PROPOSED } });
  const out2 = nameEditor(r2, 'S1');
  r2.hold('clr', 2100);
  assert.equal(out2.cancelled, 1);
  assert.equal(r2.ui.on, true);
});

test('name editor: at most 8 characters', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'ABCDEFGH');
  r.tap('right');
  r.tap('m');
  r.tap('dist');
  assert.deepEqual(out.done, ['ABCDEFGH']);
});

test('the picker survives the callout list changing while open', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  for (let i = 0; i < 10; i++) r.tap('right');
  r.ui.content = withItems('Only');
  assert.match(r.text(), /CALLOUT/);
  assert.match(r.text(), /> Only/);
  r.tap('right');
  assert.match(r.text(), /> Only/);
  r.tap('m');
  assert.deepEqual(out.picked, [1]);
});

test('name editor: an initial name longer than 8 characters is cut to 8', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'ABCDEFGHIJ');
  r.tap('dist');
  assert.deepEqual(out.done, ['ABCDEFGH']);
});
