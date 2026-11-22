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
  if (!bytes || typeof bytes.length !== 'number') return bad('The block is not a byte array');
  if (bytes.length < blockSize(0)) return bad('The block is too short');
  if (MAGIC.some((m, i) => bytes[i] !== m)) return bad('Bad magic (no callout list here)');
  if (bytes[4] !== FORMAT_VERSION) return bad(`Unsupported block version ${bytes[4]}`);
  const n = bytes[5];
  if (n > MAX_ENTRIES) return bad(`Too many entries (${n})`);
  const size = blockSize(n);
  if (bytes.length < size) return bad('The block is truncated');
  for (let i = 0; i < size; i++) {
    if (!Number.isInteger(bytes[i]) || bytes[i] < 0 || bytes[i] > 255) return bad(`Byte ${i} is not a value from 0 to 255`);
  }
  if (bytes[9] || bytes[10] || bytes[11]) return bad('The reserved header bytes are not zero');
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
