import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallouts, DEFAULT_CALLOUT_TEXT, calloutCode, calloutLabel, findCallout, defaultContent, MAX_CALLOUTS, MAX_NAME,
} from '../device/ui/callouts.js';
import { Annotations, nextName } from '../device/ui/annotations.js';
import { PROPOSED, STOCK, longMs, isProposed } from '../device/ui/profile.js';

test('profile long-press times', () => {
  assert.equal(longMs(STOCK, 'm'), 2000);
  assert.equal(longMs(PROPOSED, 'm'), 1000);
  assert.equal(longMs(PROPOSED, 'clr'), 2000);
  assert.equal(longMs(PROPOSED, 'dist'), 2000);
  assert.equal(isProposed(PROPOSED), true);
  assert.equal(isProposed(STOCK), false);
});

const DEFAULTS = ['Lead', 'Squeeze', 'Drip', 'Stream', 'Pool', 'Sump', 'Drop', 'Climb', 'Crawl', 'Breakdown', 'Flowstone', 'Column', 'Straw', 'Bats', 'Bones', 'Hazard'];

test('the default callout text parses to a flat list', () => {
  const r = parseCallouts(DEFAULT_CALLOUT_TEXT);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.items, DEFAULTS);
  assert.deepEqual(defaultContent().callouts, DEFAULTS);
  assert.equal(defaultContent().namePrefix, 'S');
  assert.equal(defaultContent().nameFirst, 1);
  assert.equal(MAX_CALLOUTS, 64);
  assert.equal(MAX_NAME, 12);
});

test('parseCallouts splits on newlines and commas and trims', () => {
  assert.deepEqual(parseCallouts('Drip\n  Pool \n\nSump').items, ['Drip', 'Pool', 'Sump']);
  assert.deepEqual(parseCallouts('Drip, Pool,Sump').items, ['Drip', 'Pool', 'Sump']);
  assert.deepEqual(parseCallouts('Drip, Pool\nSump,, ').items, ['Drip', 'Pool', 'Sump']);
  assert.deepEqual(parseCallouts('Drip\r\nPool\r\n').items, ['Drip', 'Pool'], 'CRLF is fine');
});

test('parseCallouts reports line-numbered errors', () => {
  const bad = (text) => parseCallouts(text).errors.join('\n');
  assert.match(bad('Drip\nA very long callout'), /Line 2: "A very long callout" is longer than 12 characters/);
  assert.equal(parseCallouts('Twelve chars').ok, true, '12 characters is allowed');
  assert.match(bad('Drip\n\ndrip'), /Line 3: "drip" is already in the list/);
  assert.match(bad('Drip, DRIP'), /Line 1: "DRIP" is already in the list/);
  assert.match(bad('Water: Drip, Stream'), /Line 1: "Water: Drip" has a colon; one callout per line/);
  assert.match(bad(Array.from({ length: 65 }, (_, i) => `C${i}`).join('\n')), /More than 64 callouts/);
  assert.equal(parseCallouts(Array.from({ length: 64 }, (_, i) => `C${i}`).join('\n')).ok, true);
  assert.match(bad('   \n'), /Add at least one callout/);
  assert.match(bad(''), /Add at least one callout/);
  assert.deepEqual(parseCallouts('Drip\nDrip').items, [], 'no items when not ok');
});

test('an old two-level saved text no longer parses', () => {
  assert.equal(parseCallouts('Water: Drip, Stream\nHazard: Loose').ok, false);
});

test('callout codes round trip', () => {
  assert.equal(calloutCode(0), 1);
  assert.equal(calloutCode(15), 16);
  assert.equal(calloutLabel(DEFAULTS, 1), 'Lead');
  assert.equal(calloutLabel(DEFAULTS, 3), 'Drip');
  assert.equal(calloutLabel(DEFAULTS, 16), 'Hazard');
  assert.equal(calloutLabel(DEFAULTS, 0), '');
  assert.equal(calloutLabel(DEFAULTS, 17), '');
  assert.equal(findCallout(DEFAULTS, 'Drip'), 3);
  assert.equal(findCallout(DEFAULTS, 'drip'), 0, 'case-sensitive');
  assert.equal(findCallout(DEFAULTS, 'Nope'), 0);
  DEFAULTS.forEach((n, i) => assert.equal(calloutLabel(DEFAULTS, findCallout(DEFAULTS, n)), n, `${n} at ${i}`));
});

test('nextName', () => {
  assert.equal(nextName(null, 'S', 1), 'S1');
  assert.equal(nextName('', 'T', 5), 'T5');
  assert.equal(nextName('A12'), 'A13');
  assert.equal(nextName('S9'), 'S10');
  assert.equal(nextName('S09'), 'S10');
  assert.equal(nextName('A99'), 'A100');
  assert.equal(nextName('X'), 'X1');
  assert.ok(nextName('ABCDEF99').length <= 8);
});

test('Annotations: tags and names', () => {
  const a = new Annotations();
  assert.equal(a.tag(3), 0);
  a.setTag(3, 11);
  assert.equal(a.tag(3), 11);
  assert.equal('recent' in a, false, 'no recent list');
  a.setTag(3, 0);
  assert.equal(a.tag(3), 0);
  a.setName(2, 'A12');
  assert.equal(a.name(2), 'A12');
  assert.equal(a.suggestName('S', 1), 'A13');
  a.setName(2, '');
  assert.equal(a.name(2), '');
  a.setTag(4, 1);
  a.drop(4);
  assert.equal(a.tag(4), 0);
  a.clear();
  assert.equal(a.names.size, 0);
  assert.equal(a.suggestName('S', 1), 'S1');
});

test('Annotations.remapTags follows an edited list by name', () => {
  const a = new Annotations();
  a.setTag(0, findCallout(DEFAULTS, 'Drip')); // 3
  a.setTag(1, findCallout(DEFAULTS, 'Straw')); // 13
  a.setTag(2, findCallout(DEFAULTS, 'Lead')); // 1, removed below
  const newItems = parseCallouts('Straw\nColumn\nDrip').items;
  a.remapTags((code) => {
    const label = calloutLabel(DEFAULTS, code);
    return label ? findCallout(newItems, label) : 0;
  });
  assert.equal(a.tag(0), 3, 'Drip moved to the end');
  assert.equal(a.tag(1), 1, 'Straw moved up');
  assert.equal(a.tag(2), 0, 'Lead was removed');
  assert.equal(a.tags.size, 2);
  a.remapTags(() => 0);
  assert.equal(a.tags.size, 0);
});
