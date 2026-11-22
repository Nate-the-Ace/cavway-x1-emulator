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

test('decode rejects input that is not bytes', () => {
  assert.match(decodeBlock(null).error, /not a byte array/);
  assert.match(decodeBlock(undefined).error, /not a byte array/);
  assert.match(decodeBlock(42).error, /not a byte array/);
  const good = [...encodeBlock(small)];
  assert.equal(decodeBlock(good).ok, true, 'a plain array of bytes is fine');
  const frac = [...good]; frac[14] = 65.5;
  assert.match(decodeBlock(frac).error, /not a value from 0 to 255/);
  const big = [...good]; big[7] = 256;
  assert.match(decodeBlock(big).error, /not a value from 0 to 255/);
  const hole = [...good]; hole[20] = undefined;
  assert.match(decodeBlock(hole).error, /not a value from 0 to 255/);
});

test('name bytes 0x7f and 0x80 and above are rejected', () => {
  const good = encodeBlock(small);
  for (const v of [0x7f, 0x80, 0xff]) {
    const b = Uint8Array.from(good); b[13] = v;
    const r = decodeBlock(reseal(b));
    assert.equal(r.ok, false);
    assert.match(r.error, /printable/);
  }
});

test('the reserved header bytes must be zero', () => {
  for (const at of [9, 10, 11]) {
    const b = Uint8Array.from(encodeBlock(small)); b[at] = 1;
    assert.match(decodeBlock(reseal(b)).error, /reserved/);
  }
});

test('an empty list with trailing junk, and the extremes, decode', () => {
  const empty = new Uint8Array(40).fill(0xaa);
  empty.set(encodeBlock(emptyLibrary()));
  assert.equal(decodeBlock(empty).ok, true);
  const extreme = { version: 1, revision: 65535, nextId: 251, entries: [{ id: 250, name: 'Last' }] };
  assert.deepEqual(decodeBlock(encodeBlock(extreme)).lib, extreme);
});

test('crc16 gives the same result for arrays and typed arrays', () => {
  const bytes = ascii('123456789');
  assert.equal(crc16modbus(bytes), crc16modbus(Uint8Array.from(bytes)));
});
