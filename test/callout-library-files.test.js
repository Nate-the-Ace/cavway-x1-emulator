import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../lib/callout-library/index.js';

const { toJSON, fromJSON, toText, fromText, diff, defaultLibrary, emptyLibrary, add, remove, rename, move } = lib;

const base = () => ({
  version: 1, revision: 7, nextId: 4,
  entries: [{ id: 1, name: 'Lead' }, { id: 2, name: 'Drip' }, { id: 3, name: 'Pool' }],
});
const names = (l) => l.entries.map((e) => e.name);

test('index re-exports the library', () => {
  for (const k of ['add', 'encodeBlock', 'decodeBlock', 'planWrites', 'writeLibrary', 'readLibrary', 'toJSON', 'fromText', 'diff', 'DEFAULT_NAMES']) {
    assert.ok(k in lib, k);
  }
});

test('JSON round trip and rejection', () => {
  const d = defaultLibrary();
  const json = toJSON(d);
  assert.equal(json.format, 'cavway-callouts');
  assert.equal(json.version, 1);
  const back = fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.lib, d);
  assert.match(fromJSON({ ...json, format: 'other' }).error, /Not a callout library/);
  assert.match(fromJSON({ ...json, version: 2 }).error, /Unsupported file version 2/);
  assert.match(fromJSON(null).error, /Not a callout library/);
  assert.equal(fromJSON({ ...json, entries: [{ id: 1, name: 'A' }, { id: 1, name: 'B' }], nextId: 2 }).ok, false);
  assert.equal(fromJSON({ ...json, entries: undefined }).ok, true, 'a missing list is an empty one');
});

test('fromJSON on null or nameless entries returns ok false instead of throwing', () => {
  const json = toJSON(defaultLibrary());
  assert.equal(fromJSON({ ...json, entries: [null] }).ok, false);
  assert.equal(fromJSON({ ...json, entries: [{}] }).ok, false);
  assert.equal(fromJSON({ ...json, entries: [{ id: 1 }, null] }).ok, false);
});

test('text: new library', () => {
  const r = fromText('Lead\n  Drip  \r\n\nPool\n');
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.deepEqual(names(r.lib), ['Lead', 'Drip', 'Pool']);
  assert.deepEqual(r.lib.entries.map((e) => e.id), [1, 2, 3]);
  assert.equal(r.lib.revision, 1);
  assert.equal(r.lib.nextId, 4);
  assert.equal(toText(r.lib), 'Lead\nDrip\nPool');
  assert.equal(fromText('').ok, true);
  assert.deepEqual(fromText('').lib.entries, []);
});

test('text errors are line numbered', () => {
  const r = fromText('Lead\ndrip\nDRIP\n' + 'x'.repeat(13));
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /Line 3: .*already in the list/);
  assert.match(r.errors.join('\n'), /Line 4: .*longer than 12/);
  const many = fromText(Array.from({ length: 65 }, (_, i) => `N${i}`).join('\n'));
  assert.equal(many.ok, false);
  assert.match(many.errors.join('\n'), /More than 64/);
});

test('text into an existing library keeps ids and never reuses them', () => {
  const r = fromText('Pool\nLEAD\nStraw', base());
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.deepEqual(r.lib.entries, [{ id: 3, name: 'Pool' }, { id: 1, name: 'LEAD' }, { id: 4, name: 'Straw' }]);
  assert.equal(r.lib.nextId, 5);
  assert.equal(r.lib.revision, 8);
  const again = fromText('Pool\nLEAD\nStraw\nDrip', r.lib);
  assert.equal(again.lib.entries.at(-1).id, 5, 'Drip comes back with a new id, not 2');
  assert.equal(again.lib.revision, 9);
});

test('unchanged text keeps the revision', () => {
  const same = fromText('Lead\nDrip\nPool', base());
  assert.equal(same.ok, true);
  assert.deepEqual(same.lib, base());
});

test('text that needs more ids than are left is refused', () => {
  const spent = { ...base(), nextId: 251 };
  const r = fromText('Lead\nDrip\nPool\nNew', spent);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /No ids left/);
});

test('diff', () => {
  const a = base();
  assert.deepEqual(diff(a, a), { added: [], removed: [], renamed: [], moved: [], changed: false });
  const b = rename(add(remove(a, 2).lib, 'Gear').lib, 3, 'Pools').lib;
  const d = diff(a, b);
  assert.deepEqual(d.added, [{ id: 4, name: 'Gear' }]);
  assert.deepEqual(d.removed, [{ id: 2, name: 'Drip' }]);
  assert.deepEqual(d.renamed, [{ id: 3, from: 'Pool', to: 'Pools' }]);
  assert.equal(d.changed, true);
  const m = diff(a, move(a, 3, 0).lib);
  assert.deepEqual(m.moved.map((x) => x.id).sort(), [1, 2, 3]);
  assert.equal(m.changed, true);
  assert.equal(diff(emptyLibrary(), emptyLibrary()).changed, false);
});
