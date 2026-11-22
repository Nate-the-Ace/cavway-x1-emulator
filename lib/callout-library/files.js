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
    entries: (obj.entries ?? []).map((e) => ({ id: e?.id, name: e?.name })),
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
