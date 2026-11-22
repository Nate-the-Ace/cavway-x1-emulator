// Per-shot callout tags and station names. They live in the UI model only.
export const MAX_RECENT = 3;
export const MAX_NAME_LEN = 8;

// The previous name with its trailing number incremented (A12 to A13, S09 to S10),
// or prefix + first when there is no previous name. Clipped to 8 characters.
export function nextName(last, prefix = 'S', first = 1) {
  if (!last) return `${prefix}${first}`.slice(0, MAX_NAME_LEN);
  const m = /^(.*?)(\d+)$/.exec(last);
  if (!m) return `${last}1`.slice(0, MAX_NAME_LEN);
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return `${m[1]}${n}`.slice(0, MAX_NAME_LEN);
}

export class Annotations {
  constructor() { this.clear(); }

  clear() {
    this.tags = new Map(); // shot index -> callout code
    this.names = new Map(); // shot index -> station name
    this.recent = []; // callout codes, most recent first
    this.lastName = null;
  }

  tag(i) { return this.tags.get(i) ?? 0; }

  setTag(i, code) {
    if (!code) { this.tags.delete(i); return; }
    this.tags.set(i, code);
    this.recent = [code, ...this.recent.filter((c) => c !== code)].slice(0, MAX_RECENT);
  }

  name(i) { return this.names.get(i) ?? ''; }

  setName(i, name) {
    if (!name) { this.names.delete(i); return; }
    this.names.set(i, name);
    this.lastName = name;
  }

  // Forget one shot's annotations (the shot was deleted).
  drop(i) { this.tags.delete(i); this.names.delete(i); }

  suggestName(prefix, first) { return nextName(this.lastName, prefix, first); }
}
