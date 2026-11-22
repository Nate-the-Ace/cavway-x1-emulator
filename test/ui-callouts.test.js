import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallouts, DEFAULT_CALLOUT_TEXT, calloutCode, calloutFromCode, calloutLabel, findCallout, defaultContent,
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

test('the default callout text parses', () => {
  const r = parseCallouts(DEFAULT_CALLOUT_TEXT);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.categories.length, 6);
  assert.equal(r.categories[0].name, 'Water');
  assert.ok(r.categories[0].items.includes('Drip'));
  assert.deepEqual(defaultContent().callouts, r.categories);
  assert.equal(defaultContent().namePrefix, 'S');
  assert.equal(defaultContent().nameFirst, 1);
});

test('parseCallouts reports line-numbered errors', () => {
  const bad = (text) => parseCallouts(text).errors.join('\n');
  assert.match(bad('Water Drip'), /Line 1: expected/);
  assert.match(bad(': Drip'), /Line 1: the category name is empty/);
  assert.match(bad('Water:'), /Line 1: an item name is empty/);
  assert.match(bad('Water: Drip,,Pool'), /Line 1: an item name is empty/);
  assert.match(bad('Waterfalls: Drip'), /Line 1: "Waterfalls" is longer than 8/);
  assert.match(bad('Water: Waterfalls'), /Line 1: "Waterfalls" is longer than 8/);
  assert.match(bad('Water: a,b,c,d,e,f,g,h,i'), /Line 1: more than 8 items/);
  assert.match(bad(Array.from({ length: 9 }, (_, i) => `C${i}: x`).join('\n')), /Line 9: more than 8 categories/);
  assert.match(bad('Water: Drip\n\nBad'), /Line 3: expected/);
  assert.match(bad('Water: a\nwater: b'), /Line 2: "water" is already a category/);
  assert.equal(parseCallouts('Water: Drip\r\nLife: Bats\r\n').ok, true, 'CRLF is fine');
  assert.match(bad('   \n'), /Add at least one category/);
  assert.equal(parseCallouts('Water: Drip').ok, true);
  assert.deepEqual(parseCallouts('Water Drip').categories, []);
});

test('callout codes round trip', () => {
  const cats = parseCallouts(DEFAULT_CALLOUT_TEXT).categories;
  assert.equal(calloutCode(0, 0), 1);
  assert.equal(calloutCode(1, 2), 11);
  assert.equal(calloutLabel(cats, 11), 'Straw');
  assert.deepEqual(calloutFromCode(cats, 11), { category: 'Calcite', item: 'Straw', cat: 1, itemIndex: 2 });
  assert.equal(calloutFromCode(cats, 0), null);
  assert.equal(calloutFromCode(cats, 57), null, 'category 7 does not exist');
  assert.equal(calloutLabel(cats, 6), '', 'item 6 of Water does not exist');
  assert.equal(findCallout(cats, 'Water', 'Drip'), 1);
  assert.equal(findCallout(cats, 'Passage', 'Squeeze'), 17);
  assert.equal(findCallout(cats, 'Water', 'Nope'), 0);
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

test('Annotations: tags, names, recent list', () => {
  const a = new Annotations();
  assert.equal(a.tag(3), 0);
  a.setTag(3, 11);
  a.setTag(4, 1);
  a.setTag(5, 17);
  a.setTag(6, 25);
  assert.equal(a.tag(3), 11);
  assert.deepEqual(a.recent, [25, 17, 1], 'most recent first, at most 3');
  a.setTag(7, 17);
  assert.deepEqual(a.recent, [17, 25, 1]);
  a.setTag(3, 0);
  assert.equal(a.tag(3), 0);
  a.setName(2, 'A12');
  assert.equal(a.name(2), 'A12');
  assert.equal(a.suggestName('S', 1), 'A13');
  a.setName(2, '');
  assert.equal(a.name(2), '');
  a.drop(4);
  assert.equal(a.tag(4), 0);
  a.clear();
  assert.deepEqual(a.recent, []);
  assert.equal(a.names.size, 0);
  assert.equal(a.suggestName('S', 1), 'S1');
});

test('Annotations.remapTags follows an edited list', () => {
  const a = new Annotations();
  a.setTag(0, 1); // Water > Drip
  a.setTag(1, 11); // Calcite > Straw
  const oldCats = parseCallouts(DEFAULT_CALLOUT_TEXT).categories;
  const newCats = parseCallouts('Calcite: Stalag, Column, Straw\nWater: Drip').categories;
  a.remapTags((code) => {
    const info = calloutFromCode(oldCats, code);
    return info ? findCallout(newCats, info.category, info.item) : 0;
  });
  assert.equal(a.tag(0), calloutCode(1, 0), 'Drip moved to the second category');
  assert.equal(a.tag(1), calloutCode(0, 2), 'Straw moved up');
  assert.deepEqual(a.recent, [calloutCode(0, 2), calloutCode(1, 0)]);
  a.remapTags(() => 0);
  assert.equal(a.tags.size, 0);
  assert.deepEqual(a.recent, []);
});
