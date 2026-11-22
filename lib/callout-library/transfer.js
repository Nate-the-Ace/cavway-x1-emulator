// Writing the block to X1 memory and reading it back. The memory functions are injected:
//   writeFn(addr, bytes, why) and readFn(addr, length) -> bytes, each sync or async.
// The write order makes an interrupted send harmless: the magic is zeroed first and
// written last, so a half-written block never reads as a valid list.
import { MAGIC, HEADER_BYTES, blockSize, encodeBlock, decodeBlock } from './block.js';
import { MAX_ENTRIES } from './library.js';

export const DEFAULT_CHUNK = 120;
export const DEFAULT_TIMEOUT_MS = 5000; // per read or write; 0 waits forever
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

const errorText = (e) => (e && e.message) || String(e);

// Waits for a value (or a promise of one), giving up after timeoutMs (0 = wait forever).
function settle(value, timeoutMs, what) {
  if (!timeoutMs) return Promise.resolve(value);
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), timeoutMs); });
  return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer));
}

// Reads `length` bytes in chunks. A reply of the wrong size or with a value outside 0-255 is an error.
async function readBytes(readFn, baseAddr, length, chunk, timeoutMs) {
  const out = new Uint8Array(length);
  for (const r of planReads(baseAddr, length, { chunk })) {
    const got = await settle(readFn(r.addr, r.length), timeoutMs, `a read at 0x${r.addr.toString(16)}`);
    if (!got || got.length !== r.length) throw new Error(`The read at 0x${r.addr.toString(16)} returned ${got?.length ?? 'no'} bytes, expected ${r.length}`);
    for (let i = 0; i < r.length; i++) {
      if (!Number.isInteger(got[i]) || got[i] < 0 || got[i] > 255) throw new Error(`The read at 0x${r.addr.toString(16)} returned a value that is not a byte`);
      out[r.addr - baseAddr + i] = got[i];
    }
  }
  return out;
}

// Reads the list from the device: the header first (for the count), then the rest.
export async function readLibrary(readFn, baseAddr, { chunk = DEFAULT_CHUNK, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const head = await readBytes(readFn, baseAddr, HEADER_BYTES, chunk, timeoutMs);
    const count = Math.min(head[5], MAX_ENTRIES + 1);
    const total = Math.min(blockSize(count), TOP - baseAddr);
    const all = await readBytes(readFn, baseAddr, total, chunk, timeoutMs);
    return decodeBlock(all);
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// Writes the library, then reads it back and compares. Never throws. A failure says how far the
// send got (`stage`) and what the device now holds (`deviceList`):
//   'unchanged'  nothing was written, the old list is intact
//   'invalid'    the old list was invalidated but the new one is not complete: the device uses its
//                built-in list until a send succeeds
//   'unknown'    a write or the read-back failed around the last step: read the list to find out
export async function writeLibrary(lib, { writeFn, readFn, baseAddr, chunk = DEFAULT_CHUNK, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let block;
  let plan;
  try {
    block = encodeBlock(lib);
    plan = planWrites(block, baseAddr, { chunk });
  } catch (e) {
    return { ok: false, error: errorText(e), stage: 'plan', deviceList: 'unchanged' };
  }
  let stage = 'invalidate';
  let deviceList = 'unchanged';
  try {
    for (const step of plan) {
      stage = step.why;
      deviceList = step.why === 'data' ? 'invalid' : 'unknown';
      await settle(writeFn(step.addr, step.bytes, step.why), timeoutMs, `a write at 0x${step.addr.toString(16)}`);
      if (step.why === 'invalidate') {
        // Make sure the old list really is invalid before any new data goes in.
        const check = await readBytes(readFn, baseAddr, MAGIC.length, chunk, timeoutMs);
        if (check.some((b) => b !== 0)) throw new Error('The device did not store the invalidating write');
        deviceList = 'invalid';
      }
    }
    stage = 'verify';
    deviceList = 'unknown';
    const back = await readBytes(readFn, baseAddr, block.length, chunk, timeoutMs);
    for (let i = 0; i < block.length; i++) {
      if (back[i] !== block[i]) return { ok: false, error: `Read-back differs at byte ${i}`, stage, deviceList };
    }
  } catch (e) {
    return { ok: false, error: errorText(e), stage, deviceList };
  }
  return { ok: true, bytes: block.length, writes: plan.length };
}
