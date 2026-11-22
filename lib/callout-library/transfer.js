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
