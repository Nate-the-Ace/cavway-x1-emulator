import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS, runScenario, compare, estimateMs, toMarkdown, DEFAULT_TIME_MODEL,
} from '../device/ui/scenarios.js';
import { PROPOSED, STOCK } from '../device/ui/profile.js';
import { parseCallouts } from '../device/ui/callouts.js';

const byId = (id) => SCENARIOS.find((s) => s.id === id);

test('survey 10 stations: hand-traced counts', () => {
  const sc = byId('survey-stations');
  const stock = runScenario(sc, STOCK);
  assert.equal(stock.shots, 30);
  // power-on tap, then arm + take for each of 30 shots, except the first arm shares the wake
  assert.equal(stock.totals.taps, 1 + 30 * 2);
  assert.equal(stock.totals.longs, 0);
  assert.equal(stock.names, 0);
  const prop = runScenario(sc, PROPOSED);
  // per station: long M, '>' to Name, M, DIST to accept
  assert.equal(prop.totals.taps, 61 + 10 * 3);
  assert.equal(prop.totals.longs, 10);
  assert.equal(prop.totals.holdMs, 10 * 1000);
  assert.equal(prop.names, 10);
  assert.deepEqual(prop.nameList[0], [2, 'S1']);
  assert.deepEqual(prop.nameList[9], [29, 'S10']);
  assert.equal(prop.tasks.length, 10);
});

test('tag 10 features: hand-traced first three tasks', () => {
  const sc = byId('tag-features');
  const stock = runScenario(sc, STOCK);
  assert.equal(stock.totals.taps, 4 + 9 * 3);
  assert.equal(stock.marks, 10);
  assert.deepEqual(stock.tasks.slice(0, 2).map((t) => t.taps), [4, 3]);
  const prop = runScenario(sc, PROPOSED);
  assert.deepEqual(prop.tasks.slice(0, 3).map((t) => [t.taps, t.longs]), [[5, 1], [7, 1], [8, 1]]);
  assert.equal(prop.totals.longs, 10);
  assert.equal(prop.tags, 10);
  assert.equal(prop.marks, 0);
});

test('survey with callouts: both profiles complete, proposed does more', () => {
  const sc = byId('survey-with-callouts');
  const stock = runScenario(sc, STOCK);
  const prop = runScenario(sc, PROPOSED);
  assert.equal(stock.shots, 30);
  assert.equal(prop.shots, 30);
  assert.equal(stock.marks, 10);
  assert.equal(prop.names, 10);
  assert.equal(prop.tags, 10);
  assert.ok(prop.totals.presses > stock.totals.presses);
});

test('runs are deterministic', () => {
  const sc = byId('survey-with-callouts');
  assert.deepEqual(runScenario(sc, PROPOSED), runScenario(sc, PROPOSED));
});

test('custom content is used and a missing callout is a clear error', () => {
  const sc = byId('tag-features');
  const content = { callouts: parseCallouts('Water: Splash').categories, namePrefix: 'S', nameFirst: 1 };
  assert.throws(() => runScenario(sc, PROPOSED, { content }), /No callout Water > Drip/);
});

test('both-arrows step is counted as one chord', () => {
  const sc = { id: 't', name: 't', description: '', variants: { stock: () => [{ tap: 'dist' }, { tapBoth: true }], proposed: () => [] } };
  const r = runScenario(sc, STOCK);
  assert.equal(r.totals.chords, 1);
  assert.equal(r.totals.taps, 1);
  assert.equal(r.totals.presses, 3);
});

test('estimateMs follows the time model', () => {
  const r = { totals: { taps: 10, longs: 2, chords: 0, holdMs: 2000 }, shots: 5 };
  assert.equal(estimateMs(r), 10 * 600 + 2 * 400 + 2000 + 5 * 2000);
  assert.equal(estimateMs(r, { tapMs: 1000, longExtraMs: 0, shotMs: 0 }), 12000);
  assert.deepEqual(Object.keys(DEFAULT_TIME_MODEL).sort(), ['longExtraMs', 'shotMs', 'tapMs']);
});

test('toMarkdown lists both profiles for each scenario', () => {
  const md = toMarkdown([compare(byId('tag-features'))]);
  assert.match(md, /\| Scenario \| Profile \|/);
  assert.match(md, /Tag 10 features/);
  assert.match(md, /stock-1\.1\.7/);
  assert.match(md, /proposed/);
  assert.match(md, /Est\. time/);
});
