// Callout menu content: up to 8 categories of up to 8 items, names up to 8 characters.
export const MAX_CATEGORIES = 8;
export const MAX_ITEMS = 8;
export const MAX_NAME = 8;

export const DEFAULT_CALLOUT_TEXT = [
  'Water: Drip, Stream, Sump, Pool, Fall',
  'Calcite: Stalag, Column, Straw, Drapery',
  'Passage: Squeeze, Crawl, Climb, Drop, Breakdn',
  'Hazard: Loose, Bad air, Deep',
  'Survey: Entrance, Junction, Lead, Tie-in',
  'Life: Bats, Bones, Roots',
].join('\n');

// One line per category: "Category: item, item". Returns { ok, categories, errors }.
export function parseCallouts(text) {
  const errors = [];
  const categories = [];
  const lineOf = []; // source line of each category
  String(text).split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const n = idx + 1;
    const colon = line.indexOf(':');
    if (colon < 0) { errors.push(`Line ${n}: expected "Category: item, item"`); return; }
    const name = line.slice(0, colon).trim();
    const items = line.slice(colon + 1).split(',').map((s) => s.trim());
    if (!name) { errors.push(`Line ${n}: the category name is empty`); return; }
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) errors.push(`Line ${n}: "${name}" is already a category`);
    if (name.length > MAX_NAME) errors.push(`Line ${n}: "${name}" is longer than ${MAX_NAME} characters`);
    if (items.some((s) => s === '')) { errors.push(`Line ${n}: an item name is empty`); return; }
    if (items.length > MAX_ITEMS) errors.push(`Line ${n}: more than ${MAX_ITEMS} items`);
    for (const it of items) {
      if (it.length > MAX_NAME) errors.push(`Line ${n}: "${it}" is longer than ${MAX_NAME} characters`);
    }
    categories.push({ name, items });
    lineOf.push(n);
  });
  if (categories.length === 0 && errors.length === 0) errors.push('Add at least one category');
  if (categories.length > MAX_CATEGORIES) errors.push(`Line ${lineOf[MAX_CATEGORIES]}: more than ${MAX_CATEGORIES} categories`);
  return { ok: errors.length === 0, categories: errors.length === 0 ? categories : [], errors };
}

// A callout is a number 1..64: category * 8 + item + 1. Zero means none.
export const calloutCode = (cat, item) => cat * MAX_ITEMS + item + 1;

export function calloutFromCode(categories, code) {
  if (!(code >= 1)) return null;
  const cat = Math.floor((code - 1) / MAX_ITEMS);
  const itemIndex = (code - 1) % MAX_ITEMS;
  const c = categories[cat];
  const item = c?.items[itemIndex];
  return item === undefined ? null : { category: c.name, item, cat, itemIndex };
}

export const calloutLabel = (categories, code) => calloutFromCode(categories, code)?.item ?? '';

export function findCallout(categories, categoryName, itemName) {
  const cat = categories.findIndex((c) => c.name === categoryName);
  const item = cat < 0 ? -1 : categories[cat].items.indexOf(itemName);
  return item < 0 ? 0 : calloutCode(cat, item);
}

export function defaultContent() {
  return { callouts: parseCallouts(DEFAULT_CALLOUT_TEXT).categories, namePrefix: 'S', nameFirst: 1 };
}
