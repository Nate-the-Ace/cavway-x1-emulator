import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';
import { PickerScreen } from '../device/ui/screens/picker.js';
import { NameEditScreen } from '../device/ui/screens/nameedit.js';
import { calloutCode, parseCallouts } from '../device/ui/callouts.js';

function picker(r) {
  const out = { picked: [], cancelled: 0 };
  r.tap('dist');
  r.ui.go(new PickerScreen({ onPick: (u, c) => out.picked.push(c), onCancel: () => { out.cancelled++; } }));
  return out;
}

test('level one lists categories; M opens a category; M picks an item', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  assert.match(r.text(), /CALLOUT/);
  assert.match(r.text(), /> Water/);
  assert.match(r.text(), /Calcite/);
  assert.doesNotMatch(r.text(), /Recent/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /> Passage/);
  r.tap('m');
  assert.match(r.text(), /^Passage/m);
  assert.match(r.text(), /> Squeeze/);
  r.ui.takeBeeps();
  r.tap('m');
  assert.deepEqual(out.picked, [calloutCode(2, 0)]);
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
});

test('CLR goes back a level, then cancels', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  r.tap('right');
  r.tap('right');
  r.tap('m');
  r.tap('clr');
  assert.match(r.text(), /> Passage/, 'cursor restored');
  assert.equal(out.cancelled, 0);
  r.tap('clr');
  assert.equal(out.cancelled, 1);
});

test('movement clamps at both ends', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  picker(r);
  r.tap('left');
  assert.match(r.text(), /> Water/);
  for (let i = 0; i < 20; i++) r.tap('right');
  assert.match(r.text(), /> Life/);
});

test('Recent comes first when there are recent callouts', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.ui.annotations.setTag(0, 1);
  r.ui.annotations.setTag(1, 17);
  const out = picker(r);
  assert.match(r.text(), /> Recent/);
  r.tap('m');
  assert.match(r.text(), /^Recent/m);
  assert.match(r.text(), /> Squeeze/, 'most recent first');
  assert.match(r.text(), /Drip/);
  r.tap('right');
  r.tap('m');
  assert.deepEqual(out.picked, [1]);
});

test('a long item list scrolls', () => {
  const content = { callouts: parseCallouts('Big: i1, i2, i3, i4, i5, i6, i7, i8').categories, namePrefix: 'S', nameFirst: 1 };
  const r = rig({ ui: { profile: PROPOSED, content } });
  picker(r);
  r.tap('m');
  assert.match(r.text(), /> i1/);
  assert.doesNotMatch(r.text(), /i6/);
  for (let i = 0; i < 7; i++) r.tap('right');
  assert.match(r.text(), /> i8/);
  assert.doesNotMatch(r.text(), /i1\b/);
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
  picker(r);
  r.tap('right'); r.tap('right'); r.tap('m'); // inside Passage
  r.ui.content = { callouts: parseCallouts('Only: one').categories, namePrefix: 'S', nameFirst: 1 };
  assert.match(r.text(), /CALLOUT/);
  assert.match(r.text(), /> Only/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /> Only/);
});

test('a recent callout whose label is gone is not listed', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.ui.annotations.setTag(0, 60); // no such callout
  picker(r);
  assert.doesNotMatch(r.text(), /Recent/);
});

test('name editor: an initial name longer than 8 characters is cut to 8', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'ABCDEFGHIJ');
  r.tap('dist');
  assert.deepEqual(out.done, ['ABCDEFGH']);
});
