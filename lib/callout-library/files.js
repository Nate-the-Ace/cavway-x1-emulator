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
  if (obj.entries != null && !Array.isArray(obj.entries)) return { ok: false, error: 'The library has no entries list' };
  if ((obj.entries?.length ?? 0) > MAX_ENTRIES) return { ok: false, error: `More than ${MAX_ENTRIES} callouts` };
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

// Indices of a longest increasing subsequence of seq (the entries that did not move).
function longestIncreasing(seq) {
  const n = seq.length;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (len[i] > len[best]) best = i;
  }
  const keep = new Set();
  for (let k = n ? best : -1; k >= 0; k = prev[k]) keep.add(k);
  return keep;
}

// What changed from a to b. "moved" lists the shared ids that left their relative order (the
// fewest entries that would have to move); from and to are positions in the full lists.
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
  const posInA = new Map(commonA.map((id, i) => [id, i]));
  const stay = longestIncreasing(commonB.map((id) => posInA.get(id)));
  commonB.forEach((id, i) => {
    if (!stay.has(i)) moved.push({ id, name: B.get(id).name, from: A.get(id).index, to: B.get(id).index });
  });
  const changed = added.length + removed.length + renamed.length + moved.length > 0;
  return { added, removed, renamed, moved, changed };
}

// One callout per line. With `existing`, a name that matches an existing entry (ignoring
// case) keeps its id; new names get the next ids; removed ids are retired.
export function fromText(text, existing = null) {
  if (existing) {
    const problems = checkLibrary(existing);
    if (problems.length) return { ok: false, errors: [`The existing library is invalid: ${problems[0]}`] };
  }
  const base = existing ?? emptyLibrary();
  const errors = [];
  const names = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i].trim();
    if (!name) continue;
    const problem = checkName(name);
    if (problem) { errors.push(`Line ${i + 1}: ${problem}`); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) { errors.push(`Line ${i + 1}: "${name}" is already in the list`); continue; }
    seen.add(key);
    names.push(name);
    if (names.length > MAX_ENTRIES) { errors.push(`More than ${MAX_ENTRIES} callouts`); break; }
  }
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
