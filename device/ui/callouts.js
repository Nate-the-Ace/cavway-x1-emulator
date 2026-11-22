// Callout menu content: one flat list of up to 64 names, each up to 12 characters.
export const MAX_CALLOUTS = 64;
export const MAX_NAME = 12;

// The most common cave feature callouts, most common first.
export const DEFAULT_CALLOUT_TEXT = [
  'Lead', 'Squeeze', 'Drip', 'Stream', 'Pool', 'Sump', 'Drop', 'Climb',
  'Crawl', 'Breakdown', 'Flowstone', 'Column', 'Straw', 'Bats', 'Bones', 'Hazard',
].join('\n');

// One callout per line (commas also separate). Returns { ok, items, errors }.
export function parseCallouts(text) {
  const errors = [];
  const items = [];
  const lineOf = []; // source line of each item
  String(text).split('\n').forEach((raw, idx) => {
    const n = idx + 1;
    for (const part of raw.split(',')) {
      const name = part.trim();
      if (!name) continue;
      if (name.includes(':')) { errors.push(`Line ${n}: "${name}" has a colon; one callout per line`); continue; }
      if (name.length > MAX_NAME) errors.push(`Line ${n}: "${name}" is longer than ${MAX_NAME} characters`);
      if (items.some((s) => s.toLowerCase() === name.toLowerCase())) errors.push(`Line ${n}: "${name}" is already in the list`);
      items.push(name);
      lineOf.push(n);
    }
  });
  if (items.length === 0 && errors.length === 0) errors.push('Add at least one callout');
  if (items.length > MAX_CALLOUTS) errors.push(`More than ${MAX_CALLOUTS} callouts`);
  return { ok: errors.length === 0, items: errors.length === 0 ? items : [], errors };
}

// A callout is its 1-based position in the list. Zero means none.
export const calloutCode = (index) => index + 1;

export const calloutLabel = (items, code) => (code >= 1 ? items[code - 1] ?? '' : '');

export function findCallout(items, name) {
  const i = items.indexOf(name);
  return i < 0 ? 0 : calloutCode(i);
}

export function defaultContent() {
  return { callouts: parseCallouts(DEFAULT_CALLOUT_TEXT).items, namePrefix: 'S', nameFirst: 1 };
}
