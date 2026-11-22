# Callout Library (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free JavaScript library to add, rename, remove and reorder callouts with stable ids, turn the list into a checked byte block, plan a safe write of that block to X1 memory and read it back, and save or load it as JSON or text.

**Architecture:** Pure ES modules under `lib/callout-library/`. `library.js` holds the data model, editing operations and the one validity checker. `block.js` encodes and decodes the byte block (magic, version, revision, next id, entries, CRC-16/Modbus). `transfer.js` plans the ordered `0x3e` writes (invalidate, data, commit), plans reads, and has async `writeLibrary`/`readLibrary` that take injected write and read functions, so the emulator now and a real uploader later use the same code. `files.js` converts to and from JSON and text and diffs two libraries. Spec: `docs/superpowers/specs/2026-11-22-x1-callout-library-design.md`.

**Tech Stack:** Plain JavaScript ES modules, `node --test` (`npm test`), no dependencies. The library must not import anything from `device/`, `panel/` or `test/` (it is meant to be copied into other repositories).

**User decisions (already made):**
- "The category names should not be editable on device. Just make it a list of the most common feature callouts."
- "We should just build a library for adding and editing the list from the computer and we'll flash that info over once in a while. Unless we can use the BLE to edit the list from the phone?"
- "Yes, draft it" for the spec; "Approve, write plan" for this plan (Phase A only).

**Scope:** Phase A only: the library, the block format, the write and read plan, files, tests, short docs. Not included: any change to the emulator, the panel or the Ui (Phase B), any real-unit uploader or Bluetooth test (Phase C). The block's memory address is a parameter; the emulator's guess `0x9400` is not used anywhere in this phase.

**Things the executor must know:**
- Phase 1 and the proposed-profile work are in this repo; `npm test` currently passes 191 tests and must keep passing. The library tests are new files.
- The default callout list is Lead, Squeeze, Drip, Stream, Pool, Sump, Drop, Climb, Crawl, Breakdown, Flowstone, Column, Straw, Bats, Bones, Hazard.
- CRC-16/Modbus (poly 0xA001 reflected, init 0xFFFF) of the ASCII `123456789` is `0x4b37`. The library has its own copy of the function; do not import `device/crc.js`.
- The write command's length field is one byte, so a write is at most 250 bytes; the default chunk is 120.
- Memory addresses in the protocol are 16 bit (`0x0000` to `0xFFFF`).
- Code in this plan was written without being run. If a snippet or test has a small defect, fix it minimally and say what and why. For hand-computed bytes, recompute them before changing a test.

---

## File structure

```
lib/callout-library/library.js    data model, editing, checkName, checkLibrary, defaults
lib/callout-library/block.js      crc16modbus, encodeBlock, decodeBlock, block constants
lib/callout-library/transfer.js   planWrites, planReads, writeLibrary, readLibrary
lib/callout-library/files.js      toJSON, fromJSON, toText, fromText, diff
lib/callout-library/index.js      re-exports
test/callout-library-edit.test.js, callout-library-block.test.js,
test/callout-library-transfer.test.js, callout-library-files.test.js
README.md                         modify: short section
```

---

### Task 1: The library model and editing operations

**Goal:** Stable-id callout lists with validated add, rename, remove and move, and one shared validity checker.

**Files:**
- Create: `lib/callout-library/library.js`
- Test: `test/callout-library-edit.test.js`

**Acceptance Criteria:**
- [ ] `add` gives the next id (1, 2, 3, ...), places the entry at `at` (default end), and bumps the revision; ids are never reused after `remove`
- [ ] Names are trimmed and must be 1 to 12 printable ASCII characters, unique ignoring case; the list holds at most 64; ids run out after 250 (error `No ids left`)
- [ ] `rename` keeps the id and position (and allows a change of case); `remove` retires the id; `move` clamps the index and does not bump the revision when nothing moves
- [ ] Every operation returns `{ ok, lib, error }` and never changes its input; the revision wraps at 65535
- [ ] `nameOf(lib, id)` returns the name or `#<id>` for an unknown id
- [ ] `checkLibrary` returns a list of problems (bad ids, duplicate ids, bad or duplicate names, count over 64, bad revision, bad next id)
- [ ] `fromNames` builds a library from names with line-numbered errors; `defaultLibrary()` is the 16-name default

**Verify:** `node --test test/callout-library-edit.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/callout-library-edit.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/callout-library-edit.test.js`
Expected: FAIL with `Cannot find module '../lib/callout-library/library.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/callout-library/library.js`:

```js
// A list of callouts with stable ids, edited on a computer and sent to the X1.
// No dependencies, so it can be copied into other projects.
export const MAX_ENTRIES = 64;
export const MAX_NAME = 12;
export const MAX_ID = 250;

export const DEFAULT_NAMES = [
  'Lead', 'Squeeze', 'Drip', 'Stream', 'Pool', 'Sump', 'Drop', 'Climb',
  'Crawl', 'Breakdown', 'Flowstone', 'Column', 'Straw', 'Bats', 'Bones', 'Hazard',
];

// { version, revision, nextId, entries: [{ id, name }] }. The order of entries is the
// order the picker shows. A shot's tag stores the id, so edits never change old meanings.
export const emptyLibrary = () => ({ version: 1, revision: 0, nextId: 1, entries: [] });

const printable = (s) => /^[\x20-\x7e]+$/.test(s);

// Returns a problem description, or null when the name is fine.
export function checkName(name, entries = [], exceptId = null) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return 'The name is empty';
  if (n.length > MAX_NAME) return `"${n}" is longer than ${MAX_NAME} characters`;
  if (!printable(n)) return `"${n}" has characters outside printable ASCII`;
  if (entries.some((e) => e.id !== exceptId && e.name.toLowerCase() === n.toLowerCase())) {
    return `"${n}" is already in the list`;
  }
  return null;
}

// Every problem with a library, as strings. An empty list means it is valid.
export function checkLibrary(lib) {
  if (!lib || !Array.isArray(lib.entries)) return ['The library has no entries list'];
  const errors = [];
  if (lib.version !== 1) errors.push('Unsupported library version');
  if (lib.entries.length > MAX_ENTRIES) errors.push(`More than ${MAX_ENTRIES} callouts`);
  const seen = new Set();
  lib.entries.forEach((e, i) => {
    const at = `Entry ${i + 1}`;
    if (!Number.isInteger(e.id) || e.id < 1 || e.id > MAX_ID) errors.push(`${at}: id ${e.id} is outside 1-${MAX_ID}`);
    else if (seen.has(e.id)) errors.push(`${at}: id ${e.id} is used twice`);
    seen.add(e.id);
    const problem = checkName(e.name, lib.entries.filter((x) => x !== e), e.id);
    if (problem) errors.push(`${at}: ${problem}`);
    else if (e.name !== e.name.trim()) errors.push(`${at}: the name has spaces at an end`);
  });
  if (!Number.isInteger(lib.revision) || lib.revision < 0 || lib.revision > 0xffff) {
    errors.push('The revision is outside 0-65535');
  }
  const top = lib.entries.reduce((m, e) => (Number.isInteger(e.id) ? Math.max(m, e.id) : m), 0);
  if (!Number.isInteger(lib.nextId) || lib.nextId <= top || lib.nextId > MAX_ID + 1) {
    errors.push(`nextId must be above the highest id and at most ${MAX_ID + 1}`);
  }
  return errors;
}

const bump = (lib, patch) => ({ ...lib, ...patch, revision: (lib.revision + 1) & 0xffff });
const fail = (lib, error) => ({ ok: false, lib, error });
const indexOf = (lib, id) => lib.entries.findIndex((e) => e.id === id);
const missing = (lib, id) => fail(lib, `No callout with id ${id}`);

export function add(lib, name, { at = lib.entries.length } = {}) {
  const problem = checkName(name, lib.entries);
  if (problem) return fail(lib, problem);
  if (lib.entries.length >= MAX_ENTRIES) return fail(lib, `The list is full (${MAX_ENTRIES} callouts)`);
  if (lib.nextId > MAX_ID) return fail(lib, 'No ids left (ids are never reused)');
  const pos = Math.max(0, Math.min(lib.entries.length, at));
  const entry = { id: lib.nextId, name: name.trim() };
  const entries = [...lib.entries.slice(0, pos), entry, ...lib.entries.slice(pos)];
  return { ok: true, lib: bump(lib, { entries, nextId: lib.nextId + 1 }), id: entry.id };
}

export function rename(lib, id, name) {
  const i = indexOf(lib, id);
  if (i < 0) return missing(lib, id);
  const problem = checkName(name, lib.entries, id);
  if (problem) return fail(lib, problem);
  const entries = lib.entries.map((e, k) => (k === i ? { id, name: name.trim() } : e));
  return { ok: true, lib: bump(lib, { entries }) };
}

export function remove(lib, id) {
  const i = indexOf(lib, id);
  if (i < 0) return missing(lib, id);
  return { ok: true, lib: bump(lib, { entries: lib.entries.filter((e) => e.id !== id) }) };
}

export function move(lib, id, toIndex) {
  const i = indexOf(lib, id);
  if (i < 0) return missing(lib, id);
  const to = Math.max(0, Math.min(lib.entries.length - 1, toIndex));
  if (to === i) return { ok: true, lib };
  const rest = lib.entries.filter((e) => e.id !== id);
  const entries = [...rest.slice(0, to), lib.entries[i], ...rest.slice(to)];
  return { ok: true, lib: bump(lib, { entries }) };
}

export const nameOf = (lib, id) => lib.entries.find((e) => e.id === id)?.name ?? `#${id}`;

export const findByName = (lib, name) => {
  const n = String(name).trim().toLowerCase();
  return lib.entries.find((e) => e.name.toLowerCase() === n);
};

// A new library from a list of names (ids 1, 2, ... in order, revision 1).
export function fromNames(names) {
  let lib = emptyLibrary();
  const errors = [];
  names.forEach((name, i) => {
    const r = add(lib, name);
    if (r.ok) lib = r.lib;
    else errors.push(`Line ${i + 1}: ${r.error}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, lib: { ...lib, revision: 1 } };
}

export const defaultLibrary = () => fromNames(DEFAULT_NAMES).lib;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/callout-library-edit.test.js` then `npm test`
Expected: PASS, and the existing suite still passes.

- [ ] **Step 5: Commit**

```bash
git add lib/callout-library/library.js test/callout-library-edit.test.js
git commit -m "feat: callout library model with stable ids and editing operations"
```

---

### Task 2: The block format

**Goal:** Encode a library into the fixed byte block and decode it with full validation.

**Files:**
- Create: `lib/callout-library/block.js`
- Test: `test/callout-library-block.test.js`

**Acceptance Criteria:**
- [ ] `crc16modbus` of ASCII `123456789` is `0x4b37`
- [ ] `encodeBlock` writes: magic `43 56 43 4C`, version `01`, count, revision (u16 LE), next id (1 byte), 3 zero bytes, then 13 bytes per entry (id, 12-byte name padded with 0x00), then the CRC (u16 LE) over everything before it; the size is `12 + 13 N + 2` (14 bytes empty, 846 bytes with 64 entries)
- [ ] `encodeBlock` throws on an invalid library (it uses `checkLibrary`)
- [ ] `decodeBlock` returns `{ ok: true, lib }` equal to the encoded library, ignores trailing bytes, and returns `{ ok: false, error }` for: too short, bad magic, unsupported version, count over 64, truncated, CRC mismatch, names that are empty, have non-zero bytes after the padding, or non-printable bytes, and anything `checkLibrary` rejects (duplicate or out-of-range ids, duplicate names, bad next id)

**Verify:** `node --test test/callout-library-block.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/callout-library-block.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc16modbus, encodeBlock, decodeBlock, blockSize, MAGIC, HEADER_BYTES, ENTRY_BYTES,
} from '../lib/callout-library/block.js';
import { defaultLibrary, emptyLibrary, add, MAX_ENTRIES } from '../lib/callout-library/library.js';

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// Put a correct CRC back after a test edits a block.
function reseal(block) {
  const out = Uint8Array.from(block);
  const crc = crc16modbus(out.slice(0, out.length - 2));
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = crc >> 8;
  return out;
}

const small = { version: 1, revision: 5, nextId: 3, entries: [{ id: 1, name: 'Lead' }, { id: 2, name: 'Drip' }] };

test('crc16 modbus check value', () => {
  assert.equal(crc16modbus(Uint8Array.from(ascii('123456789'))), 0x4b37);
});

test('constants and sizes', () => {
  assert.deepEqual(MAGIC, [0x43, 0x56, 0x43, 0x4c]);
  assert.equal(HEADER_BYTES, 12);
  assert.equal(ENTRY_BYTES, 13);
  assert.equal(blockSize(0), 14);
  assert.equal(blockSize(64), 846);
});

test('the layout, byte by byte', () => {
  const b = encodeBlock(small);
  assert.equal(b.length, 12 + 26 + 2);
  assert.deepEqual([...b.slice(0, 12)], [0x43, 0x56, 0x43, 0x4c, 1, 2, 5, 0, 3, 0, 0, 0]);
  assert.deepEqual([...b.slice(12, 25)], [1, ...ascii('Lead'), ...new Array(8).fill(0)]);
  assert.deepEqual([...b.slice(25, 38)], [2, ...ascii('Drip'), ...new Array(8).fill(0)]);
  const crc = crc16modbus(b.slice(0, 38));
  assert.deepEqual([b[38], b[39]], [crc & 0xff, crc >> 8]);
});

test('revision is little endian', () => {
  const b = encodeBlock({ ...small, revision: 0x1234 });
  assert.deepEqual([b[6], b[7]], [0x34, 0x12]);
  assert.equal(decodeBlock(b).lib.revision, 0x1234);
});

test('empty and full blocks', () => {
  assert.equal(encodeBlock(emptyLibrary()).length, 14);
  assert.equal(decodeBlock(encodeBlock(emptyLibrary())).ok, true);
  let lib = emptyLibrary();
  for (let i = 0; i < MAX_ENTRIES; i++) lib = add(lib, `Name${i}`).lib;
  const b = encodeBlock(lib);
  assert.equal(b.length, 846);
  assert.deepEqual(decodeBlock(b).lib, lib);
});

test('round trip of the default library, and a name that fills all 12 bytes', () => {
  const d = defaultLibrary();
  assert.deepEqual(decodeBlock(encodeBlock(d)).lib, d);
  const full = { ...small, entries: [{ id: 1, name: 'Twelve chars' }], nextId: 2 };
  assert.deepEqual(decodeBlock(encodeBlock(full)).lib, full);
});

test('trailing bytes after the block are ignored', () => {
  const b = encodeBlock(small);
  const padded = new Uint8Array(b.length + 30).fill(0xff);
  padded.set(b);
  assert.deepEqual(decodeBlock(padded).lib, small);
});

test('encodeBlock refuses an invalid library', () => {
  assert.throws(() => encodeBlock({ ...small, nextId: 1 }), /nextId/);
  assert.throws(() => encodeBlock({ ...small, entries: [{ id: 1, name: '' }] }), /empty/);
  assert.throws(() => encodeBlock({ ...small, entries: Array.from({ length: 65 }, (_, i) => ({ id: i + 1, name: `N${i}` })), nextId: 66 }), /More than 64/);
});

test('decode failures name the problem', () => {
  const good = encodeBlock(small);
  const fail = (bytes) => { const r = decodeBlock(bytes); assert.equal(r.ok, false); return r.error; };
  assert.match(fail(good.slice(0, 5)), /too short/i);
  assert.match(fail(new Uint8Array(40).fill(0xff)), /magic/i);
  const v2 = Uint8Array.from(good); v2[4] = 2;
  assert.match(fail(v2), /version 2/);
  const many = Uint8Array.from(good); many[5] = 65;
  assert.match(fail(many), /Too many/);
  assert.match(fail(good.slice(0, 30)), /truncated/i);
  const flipped = Uint8Array.from(good); flipped[14] ^= 1;
  assert.match(fail(flipped), /CRC/);
  const dupId = Uint8Array.from(good); dupId[25] = 1;
  assert.match(fail(reseal(dupId)), /used twice/);
  const id0 = Uint8Array.from(good); id0[12] = 0;
  assert.match(fail(reseal(id0)), /outside 1-250/);
  const emptyName = Uint8Array.from(good); emptyName.fill(0, 13, 25);
  assert.match(fail(reseal(emptyName)), /empty/);
  const junk = Uint8Array.from(good); junk[12 + 1 + 6] = 0x41; // a byte after the padding starts
  assert.match(fail(reseal(junk)), /padding/);
  const control = Uint8Array.from(good); control[13] = 0x07;
  assert.match(fail(reseal(control)), /printable/);
  const dupName = Uint8Array.from(good); dupName.set(ascii('lead'), 26);
  dupName.fill(0, 30, 38);
  assert.match(fail(reseal(dupName)), /already in the list/);
  const lowNext = Uint8Array.from(good); lowNext[8] = 2;
  assert.match(fail(reseal(lowNext)), /nextId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/callout-library-block.test.js`
Expected: FAIL with `Cannot find module '../lib/callout-library/block.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/callout-library/block.js`:

```js
// The byte block the X1 stores. See docs/superpowers/specs/2026-11-22-x1-callout-library-design.md.
//   0  4  magic "CVCL"        8  1  next id
//   4  1  version (1)         9  3  reserved, 0
//   5  1  entry count         12 13*N entries: 1 byte id, 12 bytes name (ASCII, 0x00 padded)
//   6  2  revision (LE)       then 2 bytes CRC-16/Modbus (LE) over everything before it
import { MAX_ENTRIES, MAX_NAME, checkLibrary } from './library.js';

export const MAGIC = [0x43, 0x56, 0x43, 0x4c];
export const FORMAT_VERSION = 1;
export const HEADER_BYTES = 12;
export const ENTRY_BYTES = 1 + MAX_NAME;
export const CRC_BYTES = 2;

export const blockSize = (count) => HEADER_BYTES + ENTRY_BYTES * count + CRC_BYTES;

export function crc16modbus(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

export function encodeBlock(lib) {
  const problems = checkLibrary(lib);
  if (problems.length) throw new Error(problems[0]);
  const n = lib.entries.length;
  const out = new Uint8Array(blockSize(n));
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  out[5] = n;
  out[6] = lib.revision & 0xff;
  out[7] = lib.revision >> 8;
  out[8] = lib.nextId;
  lib.entries.forEach((e, i) => {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    out[at] = e.id;
    for (let k = 0; k < e.name.length; k++) out[at + 1 + k] = e.name.charCodeAt(k);
  });
  const crc = crc16modbus(out.slice(0, out.length - CRC_BYTES));
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = crc >> 8;
  return out;
}

const bad = (error) => ({ ok: false, error });

// Returns { ok: true, lib } or { ok: false, error }. Bytes after the block are ignored.
export function decodeBlock(bytes) {
  if (bytes.length < blockSize(0)) return bad('The block is too short');
  if (MAGIC.some((m, i) => bytes[i] !== m)) return bad('Bad magic (no callout list here)');
  if (bytes[4] !== FORMAT_VERSION) return bad(`Unsupported block version ${bytes[4]}`);
  const n = bytes[5];
  if (n > MAX_ENTRIES) return bad(`Too many entries (${n})`);
  const size = blockSize(n);
  if (bytes.length < size) return bad('The block is truncated');
  const crc = crc16modbus(bytes.slice(0, size - CRC_BYTES));
  if ((bytes[size - 2] | (bytes[size - 1] << 8)) !== crc) return bad('CRC mismatch');
  const entries = [];
  for (let i = 0; i < n; i++) {
    const at = HEADER_BYTES + i * ENTRY_BYTES;
    const raw = bytes.slice(at + 1, at + ENTRY_BYTES);
    const end = raw.indexOf(0);
    const len = end < 0 ? MAX_NAME : end;
    if (raw.slice(len).some((b) => b !== 0)) return bad(`Entry ${i + 1}: data after the name padding`);
    if (len === 0) return bad(`Entry ${i + 1}: The name is empty`);
    const chars = [...raw.slice(0, len)];
    if (chars.some((c) => c < 0x20 || c > 0x7e)) return bad(`Entry ${i + 1}: the name has characters outside printable ASCII`);
    entries.push({ id: bytes[at], name: String.fromCharCode(...chars) });
  }
  const lib = { version: 1, revision: bytes[6] | (bytes[7] << 8), nextId: bytes[8], entries };
  const problems = checkLibrary(lib);
  return problems.length ? bad(problems[0]) : { ok: true, lib };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/callout-library-block.test.js` then `npm test`
Expected: PASS. Recheck by hand if the exact-byte test fails: the header is `43 56 43 4c 01 02 05 00 03 00 00 00`, the first entry is `01` + `Lead` + 8 zeros.

- [ ] **Step 5: Commit**

```bash
git add lib/callout-library/block.js test/callout-library-block.test.js
git commit -m "feat: callout library byte block with CRC and strict decoding"
```

---

### Task 3: Writing the block safely and reading it back

**Goal:** The ordered write plan (invalidate, data, commit), a read plan, and async `writeLibrary` and `readLibrary` that use injected memory functions.

**Files:**
- Create: `lib/callout-library/transfer.js`
- Test: `test/callout-library-transfer.test.js`

**Acceptance Criteria:**
- [ ] `planWrites(block, baseAddr, { chunk })`: first step zeroes the 4 magic bytes (`why: 'invalidate'`), then `data` steps cover bytes 4 to the end exactly once in chunks of at most `chunk`, last step writes the real magic (`why: 'commit'`)
- [ ] `planWrites` and `planReads` throw `RangeError` when the block would pass address `0xFFFF` or the chunk is outside 1-250
- [ ] `writeLibrary` runs the plan, reads the block back and compares; it returns `{ ok: true, bytes, writes }`, or `{ ok: false, error }` for an invalid library, a write failure, or a read-back mismatch (naming the first differing byte)
- [ ] Stopping the write after any step from the first up to the last data step leaves a block that `readLibrary` rejects (never a half-new list); stopping before the first write leaves the old list intact
- [ ] `readLibrary` reads the header, then the rest, and returns the decoded result; blank memory gives `{ ok: false }`

**Verify:** `node --test test/callout-library-transfer.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/callout-library-transfer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWrites, planReads, writeLibrary, readLibrary, DEFAULT_CHUNK } from '../lib/callout-library/transfer.js';
import { encodeBlock, MAGIC } from '../lib/callout-library/block.js';
import { defaultLibrary, emptyLibrary, add, remove } from '../lib/callout-library/library.js';

const BASE = 0x9400;

function memory() {
  const bytes = new Uint8Array(0x10000).fill(0xff);
  return {
    bytes,
    writes: [],
    writeFn: async (addr, data, why) => { bytes.set(data, addr); this_writes.push([addr, data.length, why]); },
    readFn: async (addr, len) => bytes.slice(addr, addr + len),
  };
}
let this_writes = [];

const fresh = () => {
  const m = memory();
  this_writes = m.writes;
  return m;
};

test('planWrites: invalidate, data, commit, with the data covered exactly once', () => {
  const block = encodeBlock(defaultLibrary());
  const plan = planWrites(block, BASE);
  assert.equal(plan[0].why, 'invalidate');
  assert.equal(plan[0].addr, BASE);
  assert.deepEqual([...plan[0].bytes], [0, 0, 0, 0]);
  assert.equal(plan.at(-1).why, 'commit');
  assert.equal(plan.at(-1).addr, BASE);
  assert.deepEqual([...plan.at(-1).bytes], MAGIC);
  const data = plan.filter((s) => s.why === 'data');
  assert.ok(data.every((s) => s.bytes.length <= DEFAULT_CHUNK));
  let next = BASE + 4;
  for (const s of data) { assert.equal(s.addr, next); next += s.bytes.length; }
  assert.equal(next, BASE + block.length);
  const rebuilt = new Uint8Array(block.length);
  for (const s of plan) rebuilt.set(s.bytes, s.addr - BASE);
  assert.deepEqual(rebuilt, block);
});

test('planWrites with a small chunk, and range checks', () => {
  const block = encodeBlock(defaultLibrary());
  const plan = planWrites(block, BASE, { chunk: 10 });
  assert.ok(plan.filter((s) => s.why === 'data').every((s) => s.bytes.length <= 10));
  assert.throws(() => planWrites(block, 0xffff - 10), RangeError);
  assert.throws(() => planWrites(block, BASE, { chunk: 0 }), RangeError);
  assert.throws(() => planWrites(block, BASE, { chunk: 251 }), RangeError);
  assert.throws(() => planWrites(block, -1), RangeError);
  assert.doesNotThrow(() => planWrites(block, 0x10000 - block.length));
});

test('planReads covers the range', () => {
  const reads = planReads(BASE, 300, { chunk: 120 });
  assert.deepEqual(reads, [{ addr: BASE, length: 120 }, { addr: BASE + 120, length: 120 }, { addr: BASE + 240, length: 60 }]);
  assert.throws(() => planReads(0xff00, 300), RangeError);
});

test('write, then read back the same library', async () => {
  const m = fresh();
  const lib = defaultLibrary();
  const r = await writeLibrary(lib, { writeFn: m.writeFn, readFn: m.readFn, baseAddr: BASE });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bytes, encodeBlock(lib).length);
  assert.equal(r.writes, m.writes.length);
  assert.equal(m.writes[0][2], 'invalidate');
  assert.equal(m.writes.at(-1)[2], 'commit');
  const back = await readLibrary(m.readFn, BASE);
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.lib, lib);
});

test('works with a chunk of 10 and with synchronous functions', async () => {
  const bytes = new Uint8Array(0x10000).fill(0xff);
  const lib = defaultLibrary();
  const r = await writeLibrary(lib, {
    writeFn: (addr, data) => { bytes.set(data, addr); },
    readFn: (addr, len) => bytes.slice(addr, addr + len),
    baseAddr: BASE,
    chunk: 10,
  });
  assert.equal(r.ok, true, r.error);
  const back = await readLibrary((a, l) => bytes.slice(a, a + l), BASE, { chunk: 7 });
  assert.deepEqual(back.lib, lib);
});

test('blank memory has no list', async () => {
  const m = fresh();
  const r = await readLibrary(m.readFn, BASE);
  assert.equal(r.ok, false);
  assert.match(r.error, /magic/i);
});

test('an interrupted write never leaves a half-new list', async () => {
  const oldLib = defaultLibrary();
  let newLib = remove(defaultLibrary(), 3).lib;
  newLib = add(newLib, 'Gear').lib;
  const steps = planWrites(encodeBlock(newLib), BASE).length;
  for (let stopAfter = 0; stopAfter <= steps; stopAfter++) {
    const m = fresh();
    await writeLibrary(oldLib, { writeFn: m.writeFn, readFn: m.readFn, baseAddr: BASE });
    let done = 0;
    const flaky = async (addr, data, why) => {
      if (done >= stopAfter) throw new Error('power lost');
      done++;
      await m.writeFn(addr, data, why);
    };
    const r = await writeLibrary(newLib, { writeFn: flaky, readFn: m.readFn, baseAddr: BASE });
    const back = await readLibrary(m.readFn, BASE);
    if (stopAfter === 0) {
      assert.equal(r.ok, false);
      assert.deepEqual(back.lib, oldLib, 'nothing written: the old list is intact');
    } else if (stopAfter < steps) {
      assert.equal(r.ok, false, `stopped after ${stopAfter}`);
      assert.equal(back.ok, false, `a block interrupted after step ${stopAfter} must be unusable`);
    } else {
      assert.equal(r.ok, true);
      assert.deepEqual(back.lib, newLib);
    }
  }
});

test('read-back mismatch is reported with the byte', async () => {
  const m = fresh();
  const bad = async (addr, len) => {
    const b = await m.readFn(addr, len);
    if (addr <= BASE + 20 && BASE + 20 < addr + len) b[BASE + 20 - addr] ^= 0xff;
    return b;
  };
  const r = await writeLibrary(defaultLibrary(), { writeFn: m.writeFn, readFn: bad, baseAddr: BASE });
  assert.equal(r.ok, false);
  assert.match(r.error, /byte 20/);
});

test('an invalid library is refused before anything is written', async () => {
  const m = fresh();
  const r = await writeLibrary({ ...emptyLibrary(), nextId: 0 }, { writeFn: m.writeFn, readFn: m.readFn, baseAddr: BASE });
  assert.equal(r.ok, false);
  assert.match(r.error, /nextId/);
  assert.equal(m.writes.length, 0);
});

test('a write that fails is reported', async () => {
  const r = await writeLibrary(defaultLibrary(), {
    writeFn: async () => { throw new Error('port closed'); },
    readFn: async () => new Uint8Array(0),
    baseAddr: BASE,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /port closed/);
});
```

Clean-up while writing the file: the `memory()` helper above uses a module-level `this_writes` only to keep the sketch short. Rewrite it properly as

```js
function memory() {
  const bytes = new Uint8Array(0x10000).fill(0xff);
  const writes = [];
  return {
    bytes,
    writes,
    writeFn: async (addr, data, why) => { bytes.set(data, addr); writes.push([addr, data.length, why]); },
    readFn: async (addr, len) => bytes.slice(addr, addr + len),
  };
}
const fresh = memory;
```

and delete the `this_writes` variable and the old `fresh`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/callout-library-transfer.test.js`
Expected: FAIL with `Cannot find module '../lib/callout-library/transfer.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/callout-library/transfer.js`:

```js
// Writing the block to X1 memory and reading it back. The memory functions are injected:
//   writeFn(addr, bytes, why) and readFn(addr, length) -> bytes, each sync or async.
// The write order makes an interrupted send harmless: the magic is zeroed first and
// written last, so a half-written block never reads as a valid list.
import { MAGIC, HEADER_BYTES, blockSize, encodeBlock, decodeBlock } from './block.js';
import { MAX_ENTRIES } from './library.js';

export const DEFAULT_CHUNK = 120;
const MAX_CHUNK = 250; // the write length field is one byte
const TOP = 0x10000; // addresses are 16 bit

function check(baseAddr, length, chunk) {
  if (!Number.isInteger(baseAddr) || baseAddr < 0) throw new RangeError('The base address must be a non-negative integer');
  if (baseAddr + length > TOP) throw new RangeError(`The block would pass address 0xFFFF (base 0x${baseAddr.toString(16)}, ${length} bytes)`);
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > MAX_CHUNK) throw new RangeError(`The chunk must be 1-${MAX_CHUNK} bytes`);
}

// Ordered writes: invalidate the magic, the rest in chunks, then the real magic.
export function planWrites(block, baseAddr, { chunk = DEFAULT_CHUNK } = {}) {
  check(baseAddr, block.length, chunk);
  const plan = [{ addr: baseAddr, bytes: new Uint8Array(MAGIC.length), why: 'invalidate' }];
  for (let off = MAGIC.length; off < block.length; off += chunk) {
    plan.push({ addr: baseAddr + off, bytes: block.slice(off, Math.min(block.length, off + chunk)), why: 'data' });
  }
  plan.push({ addr: baseAddr, bytes: block.slice(0, MAGIC.length), why: 'commit' });
  return plan;
}

export function planReads(baseAddr, length, { chunk = DEFAULT_CHUNK } = {}) {
  check(baseAddr, length, chunk);
  const reads = [];
  for (let off = 0; off < length; off += chunk) reads.push({ addr: baseAddr + off, length: Math.min(chunk, length - off) });
  return reads;
}

async function readBytes(readFn, baseAddr, length, chunk) {
  const out = new Uint8Array(length);
  for (const r of planReads(baseAddr, length, { chunk })) {
    const got = await readFn(r.addr, r.length);
    out.set(got.slice(0, r.length), r.addr - baseAddr);
  }
  return out;
}

// Reads the list from the device: the header first (for the count), then the rest.
export async function readLibrary(readFn, baseAddr, { chunk = DEFAULT_CHUNK } = {}) {
  try {
    const head = await readBytes(readFn, baseAddr, HEADER_BYTES, chunk);
    const count = Math.min(head[5], MAX_ENTRIES + 1);
    const total = Math.min(blockSize(count), TOP - baseAddr);
    const all = await readBytes(readFn, baseAddr, total, chunk);
    return decodeBlock(all);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Writes the library, then reads it back and compares. Never throws.
export async function writeLibrary(lib, { writeFn, readFn, baseAddr, chunk = DEFAULT_CHUNK }) {
  let block;
  let plan;
  try {
    block = encodeBlock(lib);
    plan = planWrites(block, baseAddr, { chunk });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    for (const step of plan) await writeFn(step.addr, step.bytes, step.why);
    const back = await readBytes(readFn, baseAddr, block.length, chunk);
    for (let i = 0; i < block.length; i++) {
      if (back[i] !== block[i]) return { ok: false, error: `Read-back differs at byte ${i}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, bytes: block.length, writes: plan.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/callout-library-transfer.test.js` then `npm test`
Expected: PASS. If the interrupted-write test shows a usable block after a stop, the order of `invalidate`, `data`, `commit` is wrong; fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add lib/callout-library/transfer.js test/callout-library-transfer.test.js
git commit -m "feat: safe write plan and read-back for the callout block"
```

---

### Task 4: Files and diffs

**Goal:** Save and load a library as JSON or text, import text into an existing library while keeping ids, and diff two libraries.

**Files:**
- Create: `lib/callout-library/files.js`, `lib/callout-library/index.js`
- Test: `test/callout-library-files.test.js`

**Acceptance Criteria:**
- [ ] `toJSON`/`fromJSON` round trip a library; `fromJSON` rejects a wrong `format`, an unsupported `version`, and anything `checkLibrary` rejects
- [ ] `toText` gives one name per line; `fromText(text)` builds a new library (ids 1.., revision 1) with line-numbered errors for empty-after-trim lines being ignored, duplicates, over-long names and more than 64 lines
- [ ] `fromText(text, existing)` keeps the id of any name that matches an existing entry ignoring case (taking the new spelling), gives new names the next ids, retires removed ids (never reused), leaves the revision unchanged when nothing changed and adds one when something did
- [ ] `diff(a, b)` reports `added`, `removed`, `renamed`, `moved` (relative order among common ids) and `changed`
- [ ] `index.js` re-exports everything from the four modules

**Verify:** `node --test test/callout-library-files.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/callout-library-files.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/callout-library-files.test.js`
Expected: FAIL with `Cannot find module '../lib/callout-library/index.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/callout-library/files.js`:

```js
// Saving, loading and comparing libraries on the computer.
import { MAX_ENTRIES, MAX_ID, emptyLibrary, checkLibrary, checkName } from './library.js';

export const FILE_FORMAT = 'cavway-callouts';

export const toJSON = (lib) => ({
  format: FILE_FORMAT,
  version: 1,
  revision: lib.revision,
  nextId: lib.nextId,
  entries: lib.entries.map(({ id, name }) => ({ id, name })),
});

export function fromJSON(obj) {
  if (!obj || obj.format !== FILE_FORMAT) return { ok: false, error: 'Not a callout library file' };
  if (obj.version !== 1) return { ok: false, error: `Unsupported file version ${obj.version}` };
  const lib = {
    version: 1,
    revision: obj.revision ?? 0,
    nextId: obj.nextId ?? 1,
    entries: (obj.entries ?? []).map((e) => ({ id: e.id, name: e.name })),
  };
  const errors = checkLibrary(lib);
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, lib };
}

export const toText = (lib) => lib.entries.map((e) => e.name).join('\n');

// What changed from a to b. "moved" lists ids whose position among the shared ids changed.
export function diff(a, b) {
  const index = (lib) => new Map(lib.entries.map((e, i) => [e.id, { name: e.name, index: i }]));
  const A = index(a);
  const B = index(b);
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];
  for (const [id, e] of B) if (!A.has(id)) added.push({ id, name: e.name });
  for (const [id, e] of A) if (!B.has(id)) removed.push({ id, name: e.name });
  for (const [id, e] of B) {
    const old = A.get(id);
    if (old && old.name !== e.name) renamed.push({ id, from: old.name, to: e.name });
  }
  const commonA = a.entries.filter((e) => B.has(e.id)).map((e) => e.id);
  const commonB = b.entries.filter((e) => A.has(e.id)).map((e) => e.id);
  commonB.forEach((id, i) => {
    if (commonA[i] !== id) moved.push({ id, name: B.get(id).name, from: A.get(id).index, to: B.get(id).index });
  });
  const changed = added.length + removed.length + renamed.length + moved.length > 0;
  return { added, removed, renamed, moved, changed };
}

// One callout per line. With `existing`, a name that matches an existing entry (ignoring
// case) keeps its id; new names get the next ids; removed ids are retired.
export function fromText(text, existing = null) {
  const base = existing ?? emptyLibrary();
  const errors = [];
  const names = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const name = raw.trim();
    if (!name) return;
    const problem = checkName(name, names.map((n, k) => ({ id: k, name: n })), null);
    if (problem) errors.push(`Line ${i + 1}: ${problem}`);
    else names.push(name);
  });
  if (names.length > MAX_ENTRIES) errors.push(`More than ${MAX_ENTRIES} callouts`);
  if (errors.length) return { ok: false, errors };
  let nextId = base.nextId;
  const entries = names.map((name) => {
    const old = base.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
    return old ? { id: old.id, name } : { id: nextId++, name };
  });
  if (nextId > MAX_ID + 1) return { ok: false, errors: ['No ids left (ids are never reused)'] };
  const lib = { version: 1, revision: base.revision, nextId, entries };
  if (!existing) return { ok: true, lib: { ...lib, revision: 1 } };
  const changed = diff(base, lib).changed || nextId !== base.nextId;
  return { ok: true, lib: changed ? { ...lib, revision: (base.revision + 1) & 0xffff } : lib };
}
```

Create `lib/callout-library/index.js`:

```js
export * from './library.js';
export * from './block.js';
export * from './transfer.js';
export * from './files.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/callout-library-files.test.js` then `npm test`
Expected: PASS. The `fromJSON({ ..., entries: undefined })` case treats a missing list as empty and `nextId` is taken from the file (here it is 17 from the default library, which is valid).

- [ ] **Step 5: Commit**

```bash
git add lib/callout-library/files.js lib/callout-library/index.js test/callout-library-files.test.js
git commit -m "feat: callout library files, text import that keeps ids, and diff"
```

---

### Task 5: Docs

**Goal:** README explains the library and its limits; the spec's block table matches the code.

**Files:**
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] README has a "Callout library" section with a short usage example, the block layout, the safe write order, and what is not done yet
- [ ] `grep -n "Callout library" README.md` finds one heading; `npm test` passes

**Verify:** `grep -n "Callout library" README.md && npm test` → one heading and all tests pass

**Steps:**

- [ ] **Step 1: Append to README**

Append to `README.md`:

````markdown
## Callout library

`lib/callout-library/` is a dependency-free module for editing the X1's callout list on a
computer and getting it onto the device as a block of memory. It does not touch the panel
or the emulated device yet. Spec: `docs/superpowers/specs/2026-11-22-x1-callout-library-design.md`.

```js
import { defaultLibrary, add, rename, move, encodeBlock, decodeBlock,
         writeLibrary, readLibrary, fromText, toText, diff } from './lib/callout-library/index.js';

let list = defaultLibrary();                 // ids 1..16, revision 1
list = add(list, 'Gear', { at: 3 }).lib;     // every edit returns { ok, lib, error }
const block = encodeBlock(list);             // the bytes the X1 would store

await writeLibrary(list, { writeFn, readFn, baseAddr });   // invalidate, data, commit, read back
const onDevice = await readLibrary(readFn, baseAddr);      // { ok, lib } or { ok: false, error }
```

- Each callout has a stable id (1 to 250, never reused). Shots store the id, so reordering,
  renaming or removing a callout never changes what an older shot means.
- Names are 1 to 12 printable ASCII characters, unique ignoring case; up to 64 callouts.
- The block is `CVCL`, version, count, revision, next id, 13 bytes per entry (id and a
  12-byte name), and a CRC-16/Modbus. At most 846 bytes.
- A send zeroes the magic first, writes the rest, and writes the magic last, so an
  interrupted send never leaves a half-new list. It then reads the block back and compares.
- Text import (`fromText(text, existing)`) keeps ids for names that already exist, so a
  list can be edited as plain text.

Not done: the emulator does not read its list from this block yet, the panel editor does
not use the library, and nothing is sent to a real X1. The real memory address and the
firmware feature to read the block need the vendor. Whether memory writes work over
Bluetooth is untested.
````

- [ ] **Step 2: Verify**

Run: `grep -n "Callout library" README.md && npm test`
Expected: one heading, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-22-x1-callout-library-design.md
git commit -m "docs: describe the callout library"
```

---

## Self-review

**Spec coverage:**
- Stable ids and never-reused ids: Task 1 (`nextId`, `add`, `remove`), Task 4 (`fromText`).
- Names printable ASCII, 1-12, unique ignoring case, max 64: Task 1.
- Block format and CRC, 846 bytes maximum, strict decoding: Task 2. The next-id byte in the header (spec table updated) is in `encodeBlock`/`decodeBlock`.
- Safe write order and read back, 120-byte chunks, 16-bit address check: Task 3.
- JSON and text files, id-preserving text import, diff before a send: Task 4.
- Library dependency-free and reusable: stated in the header; no imports from `device/`, `panel/` or `test/` (the CRC is re-implemented in `block.js`).
- Not covered by design (later phases): emulator memory block and panel editor (Phase B); real uploader and Bluetooth test (Phase C).

**Placeholder scan:** the one rough spot (the `memory()` test helper in Task 3) names its exact replacement. No TBD or "implement later".

**Type consistency:** the library shape `{ version, revision, nextId, entries: [{ id, name }] }` is the same in `library.js`, `block.js` (encode and decode), `files.js`. Editing functions return `{ ok, lib, error }` (and `id` for `add`). `planWrites` steps are `{ addr, bytes, why }` with `why` of `invalidate`, `data` or `commit`, used the same way by `writeLibrary` and the tests. `writeFn(addr, bytes, why)` and `readFn(addr, length)` match across Task 3 tests and code.

**Not executed:** the code in this plan has not been run. Expect small fixes, as in earlier phases. The hand-built bytes in Task 2 (`43 56 43 4c 01 02 05 00 03 00 00 00`, entry `01` + `Lead` + 8 zeros) are the first thing to recheck if a block test fails.
