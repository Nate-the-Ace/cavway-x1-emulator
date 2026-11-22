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
