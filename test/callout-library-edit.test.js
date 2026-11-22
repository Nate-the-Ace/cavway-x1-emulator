import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ENTRIES, MAX_NAME, MAX_ID, DEFAULT_NAMES,
  emptyLibrary, add, rename, remove, move, nameOf, findByName, checkName, checkLibrary, fromNames, defaultLibrary,
} from '../lib/callout-library/library.js';

const names = (lib) => lib.entries.map((e) => e.name);
const ids = (lib) => lib.entries.map((e) => e.id);
const must = (r) => { assert.equal(r.ok, true, r.error); return r.lib; };

test('add gives increasing ids, inserts at a position, and bumps the revision', () => {
  let lib = emptyLibrary();
  assert.equal(lib.revision, 0);
  lib = must(add(lib, 'Lead'));
  lib = must(add(lib, 'Drip'));
  lib = must(add(lib, 'Pool', { at: 1 }));
  assert.deepEqual(names(lib), ['Lead', 'Pool', 'Drip']);
  assert.deepEqual(ids(lib), [1, 3, 2]);
  assert.equal(lib.revision, 3);
  assert.equal(lib.nextId, 4);
  assert.equal(must(add(lib, 'Bats', { at: 99 })).entries.at(-1).name, 'Bats', 'at is clamped');
  assert.equal(must(add(lib, 'Bats', { at: -5 })).entries[0].name, 'Bats');
});

test('ids are never reused', () => {
  let lib = emptyLibrary();
  for (const n of ['A', 'B', 'C']) lib = must(add(lib, n));
  lib = must(remove(lib, 2));
  lib = must(add(lib, 'D'));
  assert.deepEqual(ids(lib), [1, 3, 4]);
  assert.equal(lib.nextId, 5);
});

test('names are trimmed and checked', () => {
  const lib = must(add(emptyLibrary(), 'Drip'));
  assert.equal(must(add(lib, '  Pool  ')).entries[1].name, 'Pool');
  assert.match(add(lib, '   ').error, /empty/);
  assert.match(add(lib, 'x'.repeat(MAX_NAME + 1)).error, /longer than 12/);
  assert.equal(add(lib, 'x'.repeat(MAX_NAME)).ok, true);
  assert.match(add(lib, 'Café').error, /printable ASCII/);
  assert.match(add(lib, 'drip').error, /already in the list/);
  assert.match(add(lib, 42).error, /empty/);
  assert.equal(checkName('Bad air', []), null);
});

test('the list holds at most 64 and ids run out after 250', () => {
  let lib = emptyLibrary();
  for (let i = 0; i < MAX_ENTRIES; i++) lib = must(add(lib, `N${i}`));
  const full = add(lib, 'One more');
  assert.equal(full.ok, false);
  assert.match(full.error, /full/);
  assert.equal(full.lib, lib);
  const spent = { ...emptyLibrary(), nextId: MAX_ID + 1 };
  assert.match(add(spent, 'X').error, /No ids left/);
});

test('rename keeps the id and the position', () => {
  let lib = must(add(must(add(emptyLibrary(), 'Lead')), 'Drip'));
  lib = must(rename(lib, 1, 'Leads'));
  assert.deepEqual(names(lib), ['Leads', 'Drip']);
  assert.deepEqual(ids(lib), [1, 2]);
  assert.equal(must(rename(lib, 2, 'DRIP')).entries[1].name, 'DRIP', 'a change of case is allowed');
  assert.match(rename(lib, 2, 'leads').error, /already in the list/);
  assert.match(rename(lib, 99, 'X').error, /No callout with id 99/);
});

test('remove retires the id', () => {
  const lib = must(add(must(add(emptyLibrary(), 'Lead')), 'Drip'));
  const next = must(remove(lib, 1));
  assert.deepEqual(names(next), ['Drip']);
  assert.equal(nameOf(next, 1), '#1');
  assert.equal(nameOf(next, 2), 'Drip');
  assert.match(remove(next, 1).error, /No callout with id 1/);
  assert.equal(findByName(next, 'DRIP').id, 2);
  assert.equal(findByName(next, 'Lead'), undefined);
});

test('move reorders, clamps, and does not bump the revision when nothing moves', () => {
  let lib = emptyLibrary();
  for (const n of ['A', 'B', 'C', 'D']) lib = must(add(lib, n));
  const moved = must(move(lib, 4, 0));
  assert.deepEqual(names(moved), ['D', 'A', 'B', 'C']);
  assert.equal(moved.revision, lib.revision + 1);
  assert.deepEqual(names(must(move(lib, 1, 99))), ['B', 'C', 'D', 'A']);
  const same = must(move(lib, 2, 1));
  assert.deepEqual(names(same), names(lib));
  assert.equal(same.revision, lib.revision);
  assert.match(move(lib, 9, 0).error, /No callout with id 9/);
});

test('operations never change their input', () => {
  const lib = must(add(emptyLibrary(), 'Lead'));
  const copy = JSON.parse(JSON.stringify(lib));
  add(lib, 'Drip'); rename(lib, 1, 'X'); remove(lib, 1); move(lib, 1, 0);
  assert.deepEqual(lib, copy);
});

test('the revision wraps at 65535', () => {
  const lib = { ...emptyLibrary(), revision: 65535 };
  assert.equal(must(add(lib, 'A')).revision, 0);
});

test('checkLibrary finds bad libraries', () => {
  const good = defaultLibrary();
  assert.deepEqual(checkLibrary(good), []);
  const bad = (patch) => checkLibrary({ ...good, ...patch }).join('\n');
  assert.match(bad({ version: 2 }), /version/);
  assert.match(bad({ entries: undefined }), /no entries/);
  assert.match(bad({ revision: 70000 }), /revision/);
  assert.match(bad({ nextId: 3 }), /nextId/);
  assert.match(bad({ nextId: 252 }), /nextId/);
  assert.match(bad({ entries: [{ id: 1, name: 'A' }, { id: 1, name: 'B' }], nextId: 2 }), /used twice/);
  assert.match(bad({ entries: [{ id: 0, name: 'A' }], nextId: 2 }), /outside 1-250/);
  assert.match(bad({ entries: [{ id: 1, name: 'A' }, { id: 2, name: 'a' }], nextId: 3 }), /already in the list/);
  assert.match(bad({ entries: [{ id: 1, name: ' A' }], nextId: 2 }), /spaces/);
  assert.match(bad({ entries: Array.from({ length: 65 }, (_, i) => ({ id: i + 1, name: `N${i}` })), nextId: 66 }), /More than 64/);
});

test('fromNames and the default library', () => {
  const r = fromNames(['Lead', 'Drip']);
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.lib), [1, 2]);
  assert.equal(r.lib.revision, 1);
  const bad = fromNames(['Lead', '', 'lead', 'x'.repeat(13)]);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /Line 3: .*already in the list/);
  assert.match(bad.errors.join('\n'), /Line 4: .*longer than 12/);
  const d = defaultLibrary();
  assert.deepEqual(names(d), DEFAULT_NAMES);
  assert.equal(d.entries.length, 16);
  assert.equal(d.entries[0].name, 'Lead');
  assert.equal(d.entries[15].name, 'Hazard');
  assert.equal(d.revision, 1);
});
