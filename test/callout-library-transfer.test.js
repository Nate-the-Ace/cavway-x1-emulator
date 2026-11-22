import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWrites, planReads, writeLibrary, readLibrary, DEFAULT_CHUNK } from '../lib/callout-library/transfer.js';
import { encodeBlock, MAGIC } from '../lib/callout-library/block.js';
import { defaultLibrary, emptyLibrary, add, remove } from '../lib/callout-library/library.js';

const BASE = 0x9400;

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
