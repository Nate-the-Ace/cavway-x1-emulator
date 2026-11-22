# Proposed X1 UI Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "proposed" firmware profile to the emulator's front face (callout picker, station-name editor, a both-arrows button), plus tools to judge it: a press counter, scripted scenarios compared against stock, and an editable callout list.

**Architecture:** Everything builds on the phase 1 `Ui` state machine (`device/ui/`). A profile switch (`stock-1.1.7` or `proposed`) changes long-press timing and enables new screens. Tags and names live on the Ui (`Annotations`), not in shot records. An `InputRecorder` sees every dispatched input. A scenario runner drives a throwaway X1 and Ui on a virtual clock through high-level steps (shoot, callout, name) that read the real screens, so scenarios double as usability tests. The panel gets a profile switch, counters, a scenario table and a callout editor. Spec: `docs/superpowers/specs/2026-11-22-x1-proposed-ui-preview-design.md`.

**Tech Stack:** Plain JavaScript ES modules, `node --test` (`npm test`), no dependencies. Panel is a Chrome extension side panel, also served by `node dev/serve.mjs`.

**User decisions (already made):**
- "The emulator is a design tool. I just really wanted a way to preview and test the firmware changes for usability and workflow. I won't be using it to actually emulate the device as far as interfacing with the software." So no Bluetooth, no shot-record changes, no sync.
- Testing needs wanted, all four: "Feel it by hand", "Count button presses", "Scripted scenarios", "Editable menu content".
- "Approve, write plan" for the spec.
- "add a button b ... for pressing both arrows": a sixth front-face button that presses `<` and `>` together.
- Branch `design/x1-proposed-ui`, on top of the phase 1 branch.

**Scope:** Not included: any link to other software, shot-record or memory-format changes, real-firmware comparison, saving profile-specific UI settings other than the profile and callout content.

**Things the executor must know (verified by reading the repo):**
- `device/ui/ui.js` currently holds `LONG_MS = 2000`, press/release/tick, a DIST+M chord, partner rule (while `dist` or `m` is held and unfired the other's long press waits), `SCREENS` registry, `open/go/resume`, `resetState`, beeps, `sent`.
- Screens have optional `enter(ui)`, `key(ui, button, kind)` (`kind` is `'tap'`, `'long'` or `'chord'`; button may be `'dist+m'`), `tick(ui, t)`, `render(ui)`, and flags `keepAwake`.
- `ListScreen` and `ConfirmScreen` are exported from `device/ui/screens/menu.js`. A `ListScreen` item may have `value(ui)`, and one of `adjust(ui)`, `enter(ui, self)` (returns a screen) or `run(ui, self)`. Footers are two rows (rows 6 and 7).
- The scene is 21 columns by 8 rows (`device/ui/scene.js`: `scene()`, `lr()`).
- `device/ui/shotview.js` exports `view`, `MARKS`, `MARK_CYCLE` (`[7, 0, 1, 2, 3]`, 7 = none). A record's mark is `(rec[1] >> 1) & 7`.
- Tests use `test/ui-helpers.js` `rig({ ui: { ... } })` which returns `{ clock, x1, ui, run, tap, hold, text, name }`; `rig` passes `opts.ui` to `new Ui(...)`.
- `test/helpers.js` has `FakeClock`; production code needs its own clock (Task 6).
- Phase 1 has 113 passing tests; this plan must keep them passing.
- Numbers for the scenario tests were traced by hand and are given where used. If a pinned number differs when you run it, re-trace the flow from the steps listed before changing the number.

---

## File structure

```
device/ui/profile.js           create: profile names, long-press times
device/ui/callouts.js          create: parse/validate callout text, codes, default content
device/ui/annotations.js       create: per-shot tags and names, recent list, name increment
device/ui/ui.js                modify: profile, content, annotations, long-press per profile,
                               both-arrows chord, onInput hook, handlesLongClr, setProfile
device/ui/screens/picker.js    create: two-level callout picker
device/ui/screens/nameedit.js  create: station-name editor
device/ui/screens/shotmenu.js  create: shot menu (Callout, Name, Mark, Delete shot)
device/ui/screens/measure.js   modify: pending tag, long M, tag and name rows
device/ui/screens/memory.js    modify: long M shot menu, names and tags in list and detail
device/ui/recorder.js          create: InputRecorder
device/ui/virtual-clock.js     create: clock that only moves when told
device/ui/scenarios.js         create: runner, steps, built-in scenarios, markdown
panel/keys.js, panel/face.js   modify: the B button and key
panel/preview.js               create: profile switch, counters, scenarios, callout editor
panel/panel.html, panel.css, panel.js   modify: new cards, wiring
README.md, spec                modify
test/ui-callouts.test.js, ui-profile.test.js, ui-picker.test.js, ui-shotmenu.test.js,
test/recorder.test.js, scenarios.test.js, face-keys.test.js (extend)
```

---

### Task 1: Profile, callout content and annotations (pure data)

**Goal:** The data modules the rest builds on: profile constants, callout text parsing and codes, and per-shot tags and names with a recent list and name increment.

**Files:**
- Create: `device/ui/profile.js`, `device/ui/callouts.js`, `device/ui/annotations.js`
- Test: `test/ui-callouts.test.js`

**Acceptance Criteria:**
- [ ] `parseCallouts` accepts the default text (6 categories) and rejects: a missing colon, an empty category or item, names over 8 characters, over 8 items, over 8 categories, and empty text, each with a line-numbered message
- [ ] `calloutCode(cat, item)` is `cat * 8 + item + 1`; `calloutFromCode`/`calloutLabel` invert it and return null or `''` for 0 and unknown codes
- [ ] `nextName` increments a trailing number and keeps leading zeros (`A12` to `A13`, `S09` to `S10`), starts at prefix plus first number when there is no previous name, and never exceeds 8 characters
- [ ] `Annotations` keeps tags and names by shot index, a most-recent-first list of at most 3 callout codes, and `clear()`/`drop(i)`

**Verify:** `node --test test/ui-callouts.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-callouts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCallouts, DEFAULT_CALLOUT_TEXT, calloutCode, calloutFromCode, calloutLabel, findCallout, defaultContent,
} from '../device/ui/callouts.js';
import { Annotations, nextName } from '../device/ui/annotations.js';
import { PROPOSED, STOCK, longMs, isProposed } from '../device/ui/profile.js';

test('profile long-press times', () => {
  assert.equal(longMs(STOCK, 'm'), 2000);
  assert.equal(longMs(PROPOSED, 'm'), 1000);
  assert.equal(longMs(PROPOSED, 'clr'), 2000);
  assert.equal(longMs(PROPOSED, 'dist'), 2000);
  assert.equal(isProposed(PROPOSED), true);
  assert.equal(isProposed(STOCK), false);
});

test('the default callout text parses', () => {
  const r = parseCallouts(DEFAULT_CALLOUT_TEXT);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.categories.length, 6);
  assert.equal(r.categories[0].name, 'Water');
  assert.ok(r.categories[0].items.includes('Drip'));
  assert.deepEqual(defaultContent().callouts, r.categories);
  assert.equal(defaultContent().namePrefix, 'S');
  assert.equal(defaultContent().nameFirst, 1);
});

test('parseCallouts reports line-numbered errors', () => {
  const bad = (text) => parseCallouts(text).errors.join('\n');
  assert.match(bad('Water Drip'), /Line 1: expected/);
  assert.match(bad(': Drip'), /Line 1: the category name is empty/);
  assert.match(bad('Water:'), /Line 1: an item name is empty/);
  assert.match(bad('Water: Drip,,Pool'), /Line 1: an item name is empty/);
  assert.match(bad('Waterfalls: Drip'), /Line 1: "Waterfalls" is longer than 8/);
  assert.match(bad('Water: Waterfalls'), /Line 1: "Waterfalls" is longer than 8/);
  assert.match(bad('Water: a,b,c,d,e,f,g,h,i'), /Line 1: more than 8 items/);
  assert.match(bad(Array.from({ length: 9 }, (_, i) => `C${i}: x`).join('\n')), /More than 8 categories/);
  assert.match(bad('Water: Drip\n\nBad'), /Line 3: expected/);
  assert.match(bad('   \n'), /Add at least one category/);
  assert.equal(parseCallouts('Water: Drip').ok, true);
  assert.deepEqual(parseCallouts('Water Drip').categories, []);
});

test('callout codes round trip', () => {
  const cats = parseCallouts(DEFAULT_CALLOUT_TEXT).categories;
  assert.equal(calloutCode(0, 0), 1);
  assert.equal(calloutCode(1, 2), 11);
  assert.equal(calloutLabel(cats, 11), 'Straw');
  assert.deepEqual(calloutFromCode(cats, 11), { category: 'Calcite', item: 'Straw', cat: 1, itemIndex: 2 });
  assert.equal(calloutFromCode(cats, 0), null);
  assert.equal(calloutFromCode(cats, 57), null, 'category 7 does not exist');
  assert.equal(calloutLabel(cats, 6), '', 'item 5 of Water does not exist? Water has 5 items, index 5 is empty');
  assert.equal(findCallout(cats, 'Water', 'Drip'), 1);
  assert.equal(findCallout(cats, 'Passage', 'Squeeze'), 17);
  assert.equal(findCallout(cats, 'Water', 'Nope'), 0);
});

test('nextName', () => {
  assert.equal(nextName(null, 'S', 1), 'S1');
  assert.equal(nextName('', 'T', 5), 'T5');
  assert.equal(nextName('A12'), 'A13');
  assert.equal(nextName('S9'), 'S10');
  assert.equal(nextName('S09'), 'S10');
  assert.equal(nextName('A99'), 'A100');
  assert.equal(nextName('X'), 'X1');
  assert.equal(nextName('ABCDEF99'), 'ABCDEF10'.slice(0, 8).replace('ABCDEF10', 'ABCDEF10'), 'clipped to 8');
  assert.ok(nextName('ABCDEF99').length <= 8);
});

test('Annotations: tags, names, recent list', () => {
  const a = new Annotations();
  assert.equal(a.tag(3), 0);
  a.setTag(3, 11);
  a.setTag(4, 1);
  a.setTag(5, 17);
  a.setTag(6, 25);
  assert.equal(a.tag(3), 11);
  assert.deepEqual(a.recent, [25, 17, 1], 'most recent first, at most 3');
  a.setTag(7, 17);
  assert.deepEqual(a.recent, [17, 25, 1]);
  a.setTag(3, 0);
  assert.equal(a.tag(3), 0);
  a.setName(2, 'A12');
  assert.equal(a.name(2), 'A12');
  assert.equal(a.suggestName('S', 1), 'A13');
  a.setName(2, '');
  assert.equal(a.name(2), '');
  a.drop(4);
  assert.equal(a.tag(4), 0);
  a.clear();
  assert.deepEqual(a.recent, []);
  assert.equal(a.names.size, 0);
  assert.equal(a.suggestName('S', 1), 'S1');
});
```

Two lines in that test are awkward and must be simplified when you write the file: replace the `ABCDEF99` assertion that uses `.slice(...).replace(...)` with just `assert.ok(nextName('ABCDEF99').length <= 8);`, and change the message of the `calloutLabel(cats, 6)` assertion to `'item 6 of Water does not exist'` (Water has 5 items, so code 6 is item index 5, which is empty).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-callouts.test.js`
Expected: FAIL with `Cannot find module '../device/ui/profile.js'`

- [ ] **Step 3: Write the implementation**

Create `device/ui/profile.js`:

```js
// Firmware profiles the front face can show.
export const STOCK = 'stock-1.1.7';
export const PROPOSED = 'proposed';

export const LONG_MS = 2000;
// In the proposed profile a long M is quicker, so tagging is a short hold.
export const PROPOSED_M_LONG_MS = 1000;

export const isProposed = (profile) => profile === PROPOSED;

export function longMs(profile, button) {
  return isProposed(profile) && button === 'm' ? PROPOSED_M_LONG_MS : LONG_MS;
}
```

Create `device/ui/callouts.js`:

```js
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
  String(text).split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const n = idx + 1;
    const colon = line.indexOf(':');
    if (colon < 0) { errors.push(`Line ${n}: expected "Category: item, item"`); return; }
    const name = line.slice(0, colon).trim();
    const items = line.slice(colon + 1).split(',').map((s) => s.trim());
    if (!name) { errors.push(`Line ${n}: the category name is empty`); return; }
    if (name.length > MAX_NAME) errors.push(`Line ${n}: "${name}" is longer than ${MAX_NAME} characters`);
    if (items.some((s) => s === '')) { errors.push(`Line ${n}: an item name is empty`); return; }
    if (items.length > MAX_ITEMS) errors.push(`Line ${n}: more than ${MAX_ITEMS} items`);
    for (const it of items) {
      if (it.length > MAX_NAME) errors.push(`Line ${n}: "${it}" is longer than ${MAX_NAME} characters`);
    }
    categories.push({ name, items });
  });
  if (categories.length === 0 && errors.length === 0) errors.push('Add at least one category');
  if (categories.length > MAX_CATEGORIES) errors.push(`More than ${MAX_CATEGORIES} categories`);
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
```

Create `device/ui/annotations.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-callouts.test.js` then `npm test`
Expected: PASS, and the existing suite still passes.

- [ ] **Step 5: Commit**

```bash
git add device/ui/profile.js device/ui/callouts.js device/ui/annotations.js test/ui-callouts.test.js
git commit -m "feat: profile constants, callout content and per-shot annotations"
```

---

### Task 2: Ui becomes profile-aware (long press, both arrows, hooks)

**Goal:** The `Ui` knows its profile, callout content and annotations; uses the profile's long-press times; recognizes a both-arrows input (`left+right`); lets a screen own long `CLR`; reports every dispatched input through `onInput`.

**Files:**
- Modify: `device/ui/ui.js` (replace the file with the version below)
- Test: `test/ui-profile.test.js`

**Acceptance Criteria:**
- [ ] Stock: a held `M` still needs 2 s for a long press. Proposed: 1 s, but `DIST`+`M` still chords at 2 s with no stray `M` long press
- [ ] Long `CLR` still powers off in both profiles, unless the current screen has `handlesLongClr`, in which case the screen gets `clr:long` and the X1 stays on
- [ ] Pressing `<` and `>` together and releasing dispatches one `left+right` tap; holding both for 2 s dispatches one `left+right` long press; neither arrow fires its own tap or long press then; separate arrow taps are unchanged
- [ ] `onInput` receives `{ t, button, kind, heldMs, screen }` for every dispatched input, including the power-on `DIST` press (screen `'off'`)
- [ ] `setProfile` powers off and clears annotations; `resetState` clears annotations; `ui.content` defaults to the default callouts

**Verify:** `node --test test/ui-profile.test.js` then `npm test` → all pass (the phase 1 tests must still pass)

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-profile.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED, STOCK } from '../device/ui/profile.js';

const watch = (r) => {
  const seen = [];
  r.ui.screen.key = (ui, b, kind) => seen.push(`${b}:${kind}`);
  return seen;
};

test('stock: M is a tap until 2 s', () => {
  const r = rig();
  r.tap('dist');
  r.hold('m', 1200);
  assert.equal(r.name(), 'MenuScreen' in {} ? 'x' : r.name()); // released as a tap: the menu opened
  assert.match(r.text(), /Calibration/);
});

test('proposed: M is a long press after 1 s and does not open the menu', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('m');
  r.run(900);
  assert.deepEqual(seen, []);
  r.run(200);
  assert.deepEqual(seen, ['m:long']);
  r.ui.release('m');
  assert.deepEqual(seen, ['m:long'], 'no tap after the long press');
});

test('proposed: CLR and DIST long presses are still 2 s', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  r.hold('clr', 1100);
  assert.equal(r.ui.on, true);
  r.hold('clr', 2000);
  assert.equal(r.ui.on, false);
});

test('proposed: DIST+M still chords at 2 s without a stray M long press', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('dist');
  r.run(300);
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(seen, ['dist+m:chord']);
});

test('a screen can own long CLR', () => {
  const r = rig();
  r.tap('dist');
  r.ui.screen.handlesLongClr = true;
  const seen = watch(r);
  r.hold('clr', 2100);
  assert.deepEqual(seen, ['clr:long']);
  assert.equal(r.ui.on, true);
});

test('both arrows together are one left+right tap', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('left');
  r.ui.press('right');
  r.run(100);
  r.ui.release('left');
  r.ui.release('right');
  assert.deepEqual(seen, ['left+right:tap']);
});

test('both arrows held 2 s are one left+right long press', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.ui.press('left');
  r.run(200);
  r.ui.press('right');
  r.run(2100);
  r.ui.release('right');
  r.ui.release('left');
  assert.deepEqual(seen, ['left+right:long']);
});

test('separate arrow taps are unchanged', () => {
  const r = rig();
  r.tap('dist');
  const seen = watch(r);
  r.tap('left');
  r.tap('right');
  r.hold('right', 2100);
  assert.deepEqual(seen, ['left:tap', 'right:tap', 'right:long']);
});

test('onInput reports every dispatched input', () => {
  const r = rig();
  const events = [];
  r.ui.onInput = (e) => events.push(e);
  r.tap('dist'); // power on
  r.tap('right');
  r.hold('right', 2100);
  r.ui.press('dist');
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(events.map((e) => [e.button, e.kind, e.screen]), [
    ['dist', 'tap', 'off'],
    ['right', 'tap', 'HomeScreen'],
    ['right', 'long', 'MemoryScreen'],
    ['dist+m', 'chord', 'MemoryScreen'],
  ]);
  assert.equal(events[2].heldMs >= 2000, true);
  assert.equal(typeof events[0].t, 'number');
});

test('setProfile powers off and clears annotations; resetState clears them too', () => {
  const r = rig();
  r.tap('dist');
  r.ui.annotations.setTag(0, 5);
  r.ui.annotations.setName(0, 'A1');
  r.ui.setProfile(PROPOSED);
  assert.equal(r.ui.profile, PROPOSED);
  assert.equal(r.ui.proposed, true);
  assert.equal(r.ui.on, false);
  assert.equal(r.ui.annotations.tags.size, 0);
  r.ui.annotations.setTag(1, 5);
  r.ui.resetState();
  assert.equal(r.ui.annotations.tags.size, 0);
  r.ui.setProfile(STOCK);
  assert.equal(r.ui.proposed, false);
});

test('content defaults to the default callouts and can be replaced', () => {
  const r = rig();
  assert.equal(r.ui.content.callouts.length, 6);
  const custom = { callouts: [{ name: 'X', items: ['a'] }], namePrefix: 'Q', nameFirst: 7 };
  const r2 = rig({ ui: { content: custom } });
  assert.equal(r2.ui.content.namePrefix, 'Q');
});
```

In the first test replace the second line `assert.equal(r.name(), 'MenuScreen' in {} ? 'x' : r.name());` by deleting it entirely; the `Calibration` text assertion is the real check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-profile.test.js`
Expected: FAIL (the first failure is `r.ui.proposed` or the proposed `M` long press not firing at 1 s).

- [ ] **Step 3: Write the implementation**

Replace `device/ui/ui.js` with:

```js
// The X1's front panel as a state machine: five buttons in, a scene out.
import { scene } from './scene.js';
import { defaultUiSettings } from './settings.js';
import { Instrument } from '../instrument.js';
import { HomeScreen } from './screens/home.js';
import { MeasureScreen } from './screens/measure.js';
import { MemoryScreen } from './screens/memory.js';
import { ScanScreen } from './screens/scan.js';
import { mainMenu, clearUnsentConfirm } from './screens/menu.js';
import { LONG_MS, STOCK, longMs, isProposed } from './profile.js';
import { Annotations } from './annotations.js';
import { defaultContent } from './callouts.js';

export { LONG_MS };

// Screen factories by name.
export const SCREENS = {
  home: () => new HomeScreen(),
  measure: () => new MeasureScreen(),
  memory: () => new MemoryScreen(),
  scan: () => new ScanScreen(),
  menu: () => mainMenu(),
  clearUnsentFromMeasure: () => clearUnsentConfirm((ui) => ui.open('measure')),
};

export class Ui {
  constructor({ x1, instrument = null, profile = STOCK, content = null }) {
    this.x1 = x1;
    this.instrument = instrument ?? new Instrument(x1);
    this.profile = profile;
    this.content = content ?? defaultContent(); // { callouts, namePrefix, nameFirst }
    this.annotations = new Annotations();
    this.settings = defaultUiSettings();
    this.on = false;
    this.screen = null;
    this.down = new Map(); // button -> { at, fired }
    this.beeps = [];
    this.sent = new Set(); // shot indices already transferred
    this.lastInput = x1.now();
    this.onInput = null; // ({ t, button, kind, heldMs, screen }) => void
  }

  now() { return this.x1.now(); }

  get proposed() { return isProposed(this.profile); }

  setProfile(profile) {
    this.profile = profile;
    this.powerOff();
    this.annotations.clear();
  }

  // ---- input ----------------------------------------------------------------
  press(b) {
    if (this.down.has(b)) return;
    this.lastInput = this.now();
    const entry = { at: this.now(), fired: false };
    this.down.set(b, entry);
    if (!this.on) {
      entry.fired = true; // nothing to do on release
      if (b === 'dist') {
        this._report('dist', 'tap', 0, 'off');
        this.powerOn();
      }
    }
  }

  release(b) {
    const e = this.down.get(b);
    this.down.delete(b);
    if (!e || e.fired || !this.on) return;
    this.lastInput = this.now();
    // An arrow released while the other arrow is still down: one left+right tap.
    const other = b === 'left' ? 'right' : b === 'right' ? 'left' : null;
    const p = other ? this.down.get(other) : null;
    if (p && !p.fired) {
      p.fired = true;
      this._dispatch('left+right', 'tap', this.now() - Math.max(e.at, p.at));
      return;
    }
    this._dispatch(b, 'tap', this.now() - e.at);
  }

  // Call about every 100 ms: long presses, chords, idle power-off, screen timers.
  tick() {
    if (!this.on) return;
    const t = this.now();
    const d = this.down.get('dist');
    const m = this.down.get('m');
    const l = this.down.get('left');
    const r = this.down.get('right');
    if (d && m && !d.fired && !m.fired && t - Math.max(d.at, m.at) >= LONG_MS) {
      d.fired = true;
      m.fired = true;
      this._dispatch('dist+m', 'chord', t - Math.max(d.at, m.at));
    }
    if (l && r && !l.fired && !r.fired && t - Math.max(l.at, r.at) >= LONG_MS) {
      l.fired = true;
      r.fired = true;
      this._dispatch('left+right', 'long', t - Math.max(l.at, r.at));
    }
    for (const [b, e] of this.down) {
      // While its chord partner is held and unfired, a button may still become part of a chord.
      const partner = b === 'dist' ? m : b === 'm' ? d : b === 'left' ? r : b === 'right' ? l : null;
      if (partner && !partner.fired) continue;
      if (this.on && !e.fired && t - e.at >= longMs(this.profile, b)) {
        e.fired = true;
        this._dispatch(b, 'long', t - e.at);
      }
    }
    if (!this.on) return;
    // A screen that works on its own (scan mode) keeps the X1 awake until it ends.
    if (!this.screen?.keepAwake && t - this.lastInput >= this.settings.idleOff * 1000) { this.powerOff(); return; }
    this.screen?.tick?.(this, t);
  }

  _report(button, kind, heldMs, screen) {
    this.onInput?.({ t: this.now(), button, kind, heldMs, screen });
  }

  _dispatch(b, kind, heldMs = 0) {
    this._report(b, kind, heldMs, this.screen?.constructor.name ?? 'off');
    if (b === 'clr' && kind === 'long' && !this.screen?.handlesLongClr) { this.powerOff(); return; }
    this.screen?.key?.(this, b, kind);
  }

  // ---- power ----------------------------------------------------------------
  powerOn() {
    this.on = true;
    this.x1.laser = false;
    this.open('home');
  }

  powerOff() {
    this.on = false;
    this.screen = null;
    this.x1.laser = false;
    this.x1.cali = false;
    this.down.clear();
  }

  // ---- screens --------------------------------------------------------------
  // open: a fresh screen (its enter() runs). resume: go back to a live one.
  open(name) {
    const make = SCREENS[name];
    if (!make) throw new Error(`Unknown screen: ${name}`);
    this.go(make());
  }
  go(screen) { this.screen = screen; screen.enter?.(this); }
  resume(screen) { this.screen = screen; }

  // Back to factory state for what the Ui keeps: settings, transfer flags, annotations.
  resetState() {
    Object.assign(this.settings, defaultUiSettings());
    this.sent.clear();
    this.annotations.clear();
  }

  scene() {
    if (!this.on || !this.screen) return scene([]);
    return this.screen.render(this);
  }

  backlight() { return this.on ? this.settings.backlight : 0; }

  // ---- beeps and transfer flags ----------------------------------------------
  beep(kind) { if (this.settings.beep) this.beeps.push(kind); }
  takeBeeps() { const b = this.beeps; this.beeps = []; return b; }

  isUnsent(i) { return !this.sent.has(i); }
  clearUnsent() { for (let i = 0; i < this.x1.memory.shots.length; i++) this.sent.add(i); }
}
```

Note the long-press check now uses `longMs(this.profile, b)`, and a long `M` in the stock profile is unchanged (2 s).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-profile.test.js` then `npm test`
Expected: PASS. In the `onInput` test the sequence is: power on (`dist`, screen `off`), tap `>` on Home (opens memory mode, event screen `HomeScreen`), long `>` while in memory mode (screen `MemoryScreen`), then the chord (also `MemoryScreen`). If your run differs, check that the held `right` for 2100 ms is dispatched once as `long`.

- [ ] **Step 5: Commit**

```bash
git add device/ui/ui.js test/ui-profile.test.js
git commit -m "feat: profile-aware Ui with both-arrows input, input hook and long-CLR ownership"
```

---

### Task 3: Callout picker and station-name editor screens

**Goal:** The two new screens, tested on their own (they are wired to the measure and memory screens in Task 4).

**Files:**
- Create: `device/ui/screens/picker.js`, `device/ui/screens/nameedit.js`
- Test: `test/ui-picker.test.js`

**Acceptance Criteria:**
- [ ] Picker level one lists `Recent` (only when there are recent callouts) then the categories; level two lists the items; `<` `>` move and clamp; `M` selects; `CLR` goes back a level then cancels; at most 5 rows show and the list scrolls
- [ ] Picking beeps `short` and calls `onPick(ui, code)` with the code `cat * 8 + item + 1`; the `Recent` list shows the most recent callouts first
- [ ] Name editor: `<` `>` scroll 0-9, A-Z, `-`, `.`, then `OK` and wrap; `M` adds the shown character (and returns the scroller to `0`), or finishes on `OK`; `DIST` finishes; `CLR` deletes the last character and cancels when the name is empty; long `CLR` cancels without powering off; names stop at 8 characters

**Verify:** `node --test test/ui-picker.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-picker.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';
import { PickerScreen } from '../device/ui/screens/picker.js';
import { NameEditScreen } from '../device/ui/screens/nameedit.js';
import { calloutCode, parseCallouts } from '../device/ui/callouts.js';

function picker(r) {
  const out = { picked: [], cancelled: 0 };
  r.tap('dist');
  r.ui.go(new PickerScreen({ onPick: (u, c) => out.picked.push(c), onCancel: () => { out.cancelled++; } }));
  return out;
}

test('level one lists categories; M opens a category; M picks an item', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  assert.match(r.text(), /CALLOUT/);
  assert.match(r.text(), /> Water/);
  assert.match(r.text(), /Calcite/);
  assert.doesNotMatch(r.text(), /Recent/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /> Passage/);
  r.tap('m');
  assert.match(r.text(), /^Passage/m);
  assert.match(r.text(), /> Squeeze/);
  r.ui.takeBeeps();
  r.tap('m');
  assert.deepEqual(out.picked, [calloutCode(2, 0)]);
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
});

test('CLR goes back a level, then cancels', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = picker(r);
  r.tap('right');
  r.tap('right');
  r.tap('m');
  r.tap('clr');
  assert.match(r.text(), /> Passage/, 'cursor restored');
  assert.equal(out.cancelled, 0);
  r.tap('clr');
  assert.equal(out.cancelled, 1);
});

test('movement clamps at both ends', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  picker(r);
  r.tap('left');
  assert.match(r.text(), /> Water/);
  for (let i = 0; i < 20; i++) r.tap('right');
  assert.match(r.text(), /> Life/);
});

test('Recent comes first when there are recent callouts', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  r.ui.annotations.setTag(0, 1);
  r.ui.annotations.setTag(1, 17);
  const out = picker(r);
  assert.match(r.text(), /> Recent/);
  r.tap('m');
  assert.match(r.text(), /^Recent/m);
  assert.match(r.text(), /> Squeeze/, 'most recent first');
  assert.match(r.text(), /Drip/);
  r.tap('right');
  r.tap('m');
  assert.deepEqual(out.picked, [1]);
});

test('a long item list scrolls', () => {
  const content = { callouts: parseCallouts('Big: i1, i2, i3, i4, i5, i6, i7, i8').categories, namePrefix: 'S', nameFirst: 1 };
  const r = rig({ ui: { profile: PROPOSED, content } });
  picker(r);
  r.tap('m');
  assert.match(r.text(), /> i1/);
  assert.doesNotMatch(r.text(), /i6/);
  for (let i = 0; i < 7; i++) r.tap('right');
  assert.match(r.text(), /> i8/);
  assert.doesNotMatch(r.text(), /i1\b/);
});

function nameEditor(r, initial = 'S1') {
  const out = { done: [], cancelled: 0 };
  r.tap('dist');
  r.ui.go(new NameEditScreen({ initial, onDone: (u, n) => out.done.push(n), onCancel: () => { out.cancelled++; } }));
  return out;
}

test('name editor: backspace, scroll, add, finish with DIST', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'S1');
  assert.match(r.text(), /S1\[0\]/);
  r.tap('clr');
  assert.match(r.text(), /\sS\[0\]/);
  r.tap('right');
  r.tap('right');
  assert.match(r.text(), /S\[2\]/);
  r.tap('m');
  assert.match(r.text(), /S2\[0\]/, 'the scroller returns to 0');
  r.tap('dist');
  assert.deepEqual(out.done, ['S2']);
});

test('name editor: the scroll wraps through OK, and M on OK finishes', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'AB');
  r.tap('left');
  assert.match(r.text(), /\[OK\]/);
  r.tap('left');
  assert.match(r.text(), /\[\.\]/);
  r.tap('right');
  r.tap('m');
  assert.deepEqual(out.done, ['AB']);
});

test('name editor: CLR on an empty name cancels; long CLR cancels without powering off', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'S');
  r.tap('clr');
  assert.equal(out.cancelled, 0, 'S deleted, name empty');
  r.tap('clr');
  assert.equal(out.cancelled, 1);
  const r2 = rig({ ui: { profile: PROPOSED } });
  const out2 = nameEditor(r2, 'S1');
  r2.hold('clr', 2100);
  assert.equal(out2.cancelled, 1);
  assert.equal(r2.ui.on, true);
});

test('name editor: at most 8 characters', () => {
  const r = rig({ ui: { profile: PROPOSED } });
  const out = nameEditor(r, 'ABCDEFGH');
  r.tap('right');
  r.tap('m');
  r.tap('dist');
  assert.deepEqual(out.done, ['ABCDEFGH']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-picker.test.js`
Expected: FAIL with `Cannot find module '../device/ui/screens/picker.js'`

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/picker.js`:

```js
import { scene } from '../scene.js';
import { calloutCode, calloutLabel } from '../callouts.js';

const VISIBLE = 5;

// Two levels: "Recent" (if any) and the categories, then the items of one of them.
// onPick(ui, code) and onCancel(ui) say what happens next.
export class PickerScreen {
  constructor({ onPick, onCancel }) {
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.level = 0;
    this.cursor = 0;
    this.saved0 = 0; // level-one cursor, restored on the way back
    this.category = null; // a category index, or 'recent'
  }

  _recent(ui) {
    return ui.annotations.recent
      .map((code) => ({ code, label: calloutLabel(ui.content.callouts, code) }))
      .filter((r) => r.label);
  }

  _rows(ui) {
    const cats = ui.content.callouts;
    if (this.level === 0) {
      const rows = [];
      if (this._recent(ui).length) rows.push({ label: 'Recent', recent: true });
      cats.forEach((c, i) => rows.push({ label: c.name, cat: i }));
      return rows;
    }
    if (this.category === 'recent') return this._recent(ui).map((r) => ({ label: r.label, code: r.code }));
    return cats[this.category].items.map((name, i) => ({ label: name, code: calloutCode(this.category, i) }));
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const rows = this._rows(ui);
    if (b === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (b === 'right') this.cursor = Math.min(rows.length - 1, this.cursor + 1);
    else if (b === 'm') {
      const row = rows[this.cursor];
      if (!row) return;
      if (this.level === 0) {
        this.saved0 = this.cursor;
        this.category = row.recent ? 'recent' : row.cat;
        this.level = 1;
        this.cursor = 0;
      } else {
        ui.beep('short');
        this.onPick(ui, row.code);
      }
    } else if (b === 'clr') {
      if (this.level === 1) {
        this.level = 0;
        this.cursor = this.saved0;
      } else this.onCancel(ui);
    }
  }

  render(ui) {
    const rows = this._rows(ui);
    this.cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
    const start = Math.max(0, this.cursor - (VISIBLE - 1));
    const title = this.level === 0 ? 'CALLOUT' : this.category === 'recent' ? 'Recent' : ui.content.callouts[this.category].name;
    const out = [title];
    for (let i = start; i < Math.min(rows.length, start + VISIBLE); i++) {
      out.push(`${i === this.cursor ? '> ' : '  '}${rows[i].label}`);
    }
    while (out.length < 6) out.push('');
    return scene([...out, '< >:Move M:Select', 'CLR:Back']);
  }
}
```

Create `device/ui/screens/nameedit.js`:

```js
import { scene } from '../scene.js';
import { MAX_NAME_LEN } from '../annotations.js';

export const NAME_CHARS = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.'];
export const END = 'OK';
const SCROLL = [...NAME_CHARS, END];

// Station-name entry on five buttons. '<' '>' scroll the character, M adds it (or
// finishes on OK), CLR deletes (cancels when empty), long CLR cancels, DIST finishes.
export class NameEditScreen {
  handlesLongClr = true;

  constructor({ initial = '', onDone, onCancel }) {
    this.name = initial.slice(0, MAX_NAME_LEN);
    this.idx = 0;
    this.onDone = onDone;
    this.onCancel = onCancel;
  }

  key(ui, b, kind) {
    if (kind === 'long') {
      if (b === 'clr') this.onCancel(ui);
      return;
    }
    if (kind !== 'tap') return;
    if (b === 'left') this.idx = (this.idx + SCROLL.length - 1) % SCROLL.length;
    else if (b === 'right') this.idx = (this.idx + 1) % SCROLL.length;
    else if (b === 'm') {
      const c = SCROLL[this.idx];
      if (c === END) this.onDone(ui, this.name);
      else if (this.name.length < MAX_NAME_LEN) {
        this.name += c;
        this.idx = 0;
      }
    } else if (b === 'dist') this.onDone(ui, this.name);
    else if (b === 'clr') {
      if (this.name.length) this.name = this.name.slice(0, -1);
      else this.onCancel(ui);
    }
  }

  render() {
    return scene(['STATION NAME', '', `  ${this.name}[${SCROLL[this.idx]}]`, '', '', '', '<>:Char M:Add DIST:OK', 'CLR:Del CLR2s:Cancel']);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-picker.test.js` then `npm test`
Expected: PASS. If `/\sS\[0\]/` fails after the first backspace, the row is `  S[0]` (two leading spaces); adjust the regex to `/S\[0\]/` and keep the intent (the `1` is gone).

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/picker.js device/ui/screens/nameedit.js test/ui-picker.test.js
git commit -m "feat: callout picker and station-name editor screens"
```

---

### Task 4: Shot menu and wiring into the measure and memory screens

**Goal:** In the proposed profile, long `M` opens the picker while armed and the shot menu after a shot or in memory mode; tags and names show on the measure and memory screens.

**Files:**
- Create: `device/ui/screens/shotmenu.js`
- Modify: `device/ui/screens/measure.js` (replace the file), `device/ui/screens/memory.js` (patches below)
- Test: `test/ui-shotmenu.test.js`

**Acceptance Criteria:**
- [ ] Stock profile: long `M` does nothing new on the measure and memory screens; all phase 1 screen tests still pass
- [ ] Proposed, armed: long `M` opens the picker; picking sets a pending tag shown as `Tag: <item>`; the next shot gets that tag; the pending tag clears after the shot
- [ ] Proposed, after a shot: long `M` opens a shot menu with Callout, Name, Mark and (only for the last shot) Delete shot. Callout opens the picker for that shot; Name opens the editor starting at the existing name or the suggested next name; Mark cycles the stored mark; Delete shot asks to confirm, removes the last shot and its annotations, and re-arms the laser. Picking or finishing returns to the measure result; cancelling returns to the shot menu
- [ ] The measure result shows `Tag:` on row 6 and `Stn:` on row 7 when they exist
- [ ] Memory mode, proposed: long `M` opens the shot menu for the shot under the cursor (and returns there); the list header shows the shot's name on the right; the list tail `_` shows for a mark or a tag; the last detail page shows `Tag:`

**Verify:** `node --test test/ui-shotmenu.test.js` then `npm test` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/ui-shotmenu.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';
import { PROPOSED } from '../device/ui/profile.js';
import { view } from '../device/ui/shotview.js';

const prop = () => rig({ ui: { profile: PROPOSED } });
const shoot = (r) => { r.tap('dist'); r.tap('dist'); r.tap('dist'); }; // wake, arm, take (first shot)
const again = (r) => { r.tap('dist'); r.tap('dist'); }; // arm, take (later shots)

test('stock: long M does nothing special', () => {
  const r = rig();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MeasureScreen');
  shoot; // eslint-friendly no-op reference
  r.tap('dist');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MeasureScreen');
});

test('armed: long M opens the picker; the pick tags the next shot', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 1000);
  assert.equal(r.name(), 'PickerScreen');
  r.tap('m'); // Water
  r.tap('m'); // Drip
  assert.equal(r.name(), 'MeasureScreen');
  assert.match(r.text(), /Tag: Drip/);
  r.tap('dist'); // take
  assert.equal(r.ui.annotations.tag(0), 1);
  assert.match(r.text(), /Tag: Drip/);
  r.tap('dist'); // arm again
  assert.doesNotMatch(r.text(), /Tag:/, 'the pending tag cleared');
});

test('armed: cancelling the picker keeps the measure screen armed', () => {
  const r = prop();
  r.tap('dist'); r.tap('dist');
  r.hold('m', 1000);
  r.tap('clr');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true);
  assert.doesNotMatch(r.text(), /Tag:/);
});

test('after a shot: the shot menu, Name with the suggested next name', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  assert.equal(r.name(), 'ListScreen');
  for (const l of ['Callout', 'Name', 'Mark', 'Delete shot']) assert.match(r.text(), new RegExp(l));
  assert.match(r.text(), /> Callout/);
  r.tap('right');
  r.tap('m');
  assert.match(r.text(), /S1\[0\]/);
  r.tap('dist');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.ui.annotations.name(0), 'S1');
  assert.match(r.text(), /Stn: S1/);
  again(r);
  r.hold('m', 1000);
  r.tap('right');
  r.tap('m');
  assert.match(r.text(), /S2\[0\]/, 'the next name follows the last one');
  r.tap('dist');
  assert.equal(r.ui.annotations.name(1), 'S2');
});

test('after a shot: Callout tags that shot; cancel returns to the shot menu', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  r.tap('m'); // Callout
  assert.equal(r.name(), 'PickerScreen');
  r.tap('clr');
  assert.equal(r.name(), 'ListScreen');
  assert.match(r.text(), /> Callout/);
  r.tap('m');
  r.tap('right'); // Calcite
  r.tap('m');
  r.tap('m'); // Stalag
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.ui.annotations.tag(0), 9);
  assert.match(r.text(), /Tag: Stalag/);
});

test('shot menu: Mark cycles the stored mark', () => {
  const r = prop();
  shoot(r);
  r.hold('m', 1000);
  r.tap('right'); r.tap('right');
  assert.match(r.text(), /> Mark +None/);
  r.tap('m');
  assert.match(r.text(), /> Mark +Feature/);
  assert.equal(view(r.x1.memory.shots[0]).mark, 0);
});

test('shot menu: Delete shot only for the last shot, with confirmation', () => {
  const r = prop();
  shoot(r);
  again(r);
  r.ui.annotations.setName(1, 'S2');
  r.hold('m', 1000);
  for (let i = 0; i < 3; i++) r.tap('right');
  assert.match(r.text(), /> Delete shot/);
  r.tap('m');
  assert.match(r.text(), /Delete shot\?/);
  r.tap('clr');
  assert.match(r.text(), /> Delete shot/, 'cancel returns to the menu');
  r.tap('m');
  r.tap('m');
  assert.equal(r.x1.memory.shots.length, 1);
  assert.equal(r.ui.annotations.name(1), '');
  assert.equal(r.name(), 'MeasureScreen');
  assert.equal(r.x1.laser, true, 're-armed');
});

test('memory mode: long M opens the shot menu for the shot under the cursor', () => {
  const r = prop();
  r.ui.instrument.pose = { az: 10, inc: 0, dist: 2 };
  r.ui.instrument.fire({});
  r.ui.instrument.pose = { az: 200, inc: 0, dist: 3 };
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('right'); // memory mode, newest shot (index 1)
  r.tap('right'); // cursor on index 0
  r.hold('m', 1000);
  assert.equal(r.name(), 'ListScreen');
  assert.doesNotMatch(r.text(), /Delete shot/, 'not the last shot');
  r.tap('right');
  r.tap('m');
  r.tap('dist'); // accept S1 for shot index 0
  assert.equal(r.name(), 'MemoryScreen');
  assert.equal(r.ui.annotations.name(0), 'S1');
  assert.match(r.text(), /SHOT # 1 +S1/);
});

test('memory mode: tagged shots show an underscore and the tag on the last detail page', () => {
  const r = prop();
  r.ui.instrument.fire({});
  r.ui.annotations.setTag(0, 1);
  r.tap('dist');
  r.tap('right');
  assert.match(r.text(), /\*_/);
  r.tap('m');
  r.tap('m'); r.tap('m'); r.tap('m');
  assert.match(r.text(), /Tag: +Drip/);
});

test('stock memory mode: long M does nothing', () => {
  const r = rig();
  r.ui.instrument.fire({});
  r.tap('dist');
  r.tap('right');
  r.hold('m', 2100);
  assert.equal(r.name(), 'MemoryScreen');
});
```

Clean-up while writing the file: delete the stray `shoot; // eslint-friendly no-op reference` line in the first test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ui-shotmenu.test.js`
Expected: FAIL (the first failing test is the picker opening: `r.name()` is `MeasureScreen`).

- [ ] **Step 3: Write the implementation**

Create `device/ui/screens/shotmenu.js`:

```js
import { ListScreen, ConfirmScreen } from './menu.js';
import { PickerScreen } from './picker.js';
import { NameEditScreen } from './nameedit.js';
import { MARKS, MARK_CYCLE } from '../shotview.js';
import { calloutLabel } from '../callouts.js';

// Opened by a long M in the proposed profile. `parent` is the screen to go back to.
export function shotMenu({ ui, index, parent }) {
  const back = (u) => u.resume(parent);
  const rec = (u) => u.x1.memory.shots[index];
  const isLast = index === ui.x1.memory.shots.length - 1;
  const items = [
    {
      label: 'Callout',
      value: (u) => calloutLabel(u.content.callouts, u.annotations.tag(index)),
      enter: (u, self) => new PickerScreen({
        onPick: (u2, code) => { u2.annotations.setTag(index, code); back(u2); },
        onCancel: (u2) => u2.resume(self),
      }),
    },
    {
      label: 'Name',
      value: (u) => u.annotations.name(index),
      enter: (u, self) => new NameEditScreen({
        initial: u.annotations.name(index) || u.annotations.suggestName(u.content.namePrefix, u.content.nameFirst),
        onDone: (u2, name) => { u2.annotations.setName(index, name); back(u2); },
        onCancel: (u2) => u2.resume(self),
      }),
    },
    {
      label: 'Mark',
      value: (u) => MARKS[(rec(u)[1] >> 1) & 7],
      adjust: (u) => {
        const r = rec(u);
        const next = MARK_CYCLE[(MARK_CYCLE.indexOf((r[1] >> 1) & 7) + 1) % MARK_CYCLE.length];
        r[1] = (r[1] & ~0x0e) | (next << 1);
      },
    },
  ];
  if (isLast) {
    items.push({
      label: 'Delete shot',
      enter: (u, self) => new ConfirmScreen(
        ['', 'Delete shot?', ' The last one'],
        (u2) => {
          u2.x1.memory.shots.pop();
          u2.annotations.drop(index);
          u2.sent.delete(index);
          u2.open('measure');
        },
        (u2) => u2.resume(self),
      ),
    });
  }
  return new ListScreen({ items, back, footer: ['< >:Prev/Next', 'M:Enter CLR:Back'] });
}
```

Replace `device/ui/screens/measure.js` with:

```js
import { scene, lr } from '../scene.js';
import { fmtAngle, fmtDist } from '../format.js';
import { view, MARKS, MARK_CYCLE } from '../shotview.js';
import { calloutLabel } from '../callouts.js';
import { PickerScreen } from './picker.js';
import { shotMenu } from './shotmenu.js';

const NONE = 7;

// Laser on, then shot, then result pages.
export class MeasureScreen {
  constructor() {
    this.mark = NONE;
    this.tag = 0; // callout picked before the shot (proposed profile)
    this.result = null; // { index, leg } once a shot was taken
    this.page = 0;
    this.dueAt = null; // delayed shot time
  }

  enter(ui) { this.arm(ui); }

  arm(ui) {
    this.result = null;
    this.page = 0;
    this.dueAt = null;
    this.tag = 0;
    ui.x1.laser = true;
  }

  take(ui) {
    this.dueAt = null;
    // x1.measure() clears the laser itself; if the shot fails the laser stays on.
    const r = ui.instrument.fire({ flag: this.mark });
    if (!r) return;
    this.result = r;
    this.page = 0;
    this.mark = NONE;
    if (this.tag) ui.annotations.setTag(r.index, this.tag);
    this.tag = 0;
    ui.beep(view(ui.x1.memory.shots[r.index]).hasErr ? 'long' : 'short');
    if (r.leg) ui.beep('double');
  }

  key(ui, b, kind) {
    const armed = this.result === null;
    const s = ui.settings;
    if (b === 'dist+m') {
      if (armed && s.scanEnable && s.scanTrigger === 'DIST+M') ui.open('scan');
      return;
    }
    if (kind === 'long') {
      if (b === 'dist' && armed) {
        if (s.shotDelay === 0) this.take(ui);
        else this.dueAt = ui.now() + s.shotDelay * 1000;
      } else if (b === 'right') {
        // Scan can use '>' as its trigger; otherwise it is the clear-unsent hotkey.
        if (s.scanEnable && s.scanTrigger === '>') ui.open('scan');
        else ui.open('clearUnsentFromMeasure');
      } else if (b === 'm' && ui.proposed) {
        if (armed) {
          ui.go(new PickerScreen({
            onPick: (u, code) => { this.tag = code; u.resume(this); },
            onCancel: (u) => u.resume(this),
          }));
        } else ui.go(shotMenu({ ui, index: this.result.index, parent: this }));
      }
      return;
    }
    if (kind !== 'tap') return;
    if (b === 'dist') {
      if (this.dueAt !== null) this.dueAt = null;
      else if (armed) this.take(ui);
      else this.arm(ui);
    } else if (b === 'm') {
      if (armed) this.mark = MARK_CYCLE[(MARK_CYCLE.indexOf(this.mark) + 1) % MARK_CYCLE.length];
      else ui.open('menu');
    } else if (b === 'left' || b === 'right') {
      if (armed) { ui.x1.laser = false; ui.open('memory'); }
      else this.page = (this.page + (b === 'right' ? 1 : 2)) % 3;
    } else if (b === 'clr') {
      ui.x1.laser = false;
      ui.open('home');
    }
  }

  tick(ui, t) {
    if (this.dueAt !== null && t >= this.dueAt) this.take(ui);
  }

  render(ui) {
    const s = ui.settings;
    if (this.result) return this._result(ui);
    const p = ui.instrument.pose;
    const rows = [
      lr('AZM', fmtAngle(p.az, s.angleUnit)),
      lr('INCL', fmtAngle(p.inc, s.angleUnit)),
      '',
      this.mark === NONE ? '' : lr('', MARKS[this.mark]),
      '',
      lr('DIST', fmtDistPlaceholder(s.distUnit)),
    ];
    if (this.dueAt !== null) rows[6] = `Shot in ${Math.ceil((this.dueAt - ui.now()) / 1000)}s`;
    else if (this.tag) rows[6] = `Tag: ${calloutLabel(ui.content.callouts, this.tag)}`;
    return scene(rows);
  }

  _result(ui) {
    const s = ui.settings;
    const v = view(ui.x1.memory.shots[this.result.index]);
    if (this.page === 1) {
      const errs = v.hasErr ? v.errKinds.map((k) => `${k} error`) : ['No error'];
      const rows = ['Accuracy Error', ...errs];
      while (rows.length < 6) rows.push('');
      return scene([...rows, '< >:Prev/Next page', 'M:Menu CLR:Home']);
    }
    if (this.page === 2) {
      const inc = (v.inclination * Math.PI) / 180;
      return scene([
        lr('Horizontal', fmtDist(v.distance * Math.cos(inc), s.distUnit)),
        lr('Vertical', fmtDist(v.distance * Math.sin(inc), s.distUnit)),
        lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
        '', '', '', '< >:Prev/Next page', 'M:Menu CLR:Home',
      ]);
    }
    const tag = calloutLabel(ui.content.callouts, ui.annotations.tag(this.result.index));
    const name = ui.annotations.name(this.result.index);
    return scene([
      lr('AZM', fmtAngle(v.azimuth, s.angleUnit)),
      lr('INCL', fmtAngle(v.inclination, s.angleUnit)),
      '',
      v.mark === NONE ? '' : lr('', MARKS[v.mark]),
      lr(v.isLeg ? 'LEG' : '', v.hasErr ? 'ACC ERR' : ''),
      lr('DIST', fmtDist(v.distance, s.distUnit)),
      tag ? `Tag: ${tag}` : '',
      name ? `Stn: ${name}` : '',
    ]);
  }
}

const fmtDistPlaceholder = (unit) => `---- ${unit}`;
```

Patch `device/ui/screens/memory.js` (apply each replacement exactly once; each must match, so run the edits with a script that asserts that):

1. Imports: after `import { view, MARKS } from '../shotview.js';` add
   `import { calloutLabel } from '../callouts.js';` and `import { shotMenu } from './shotmenu.js';`
2. In `key(ui, b, kind)`, replace
   ```js
       if (kind !== 'tap') return;
       const n = this._n(ui);
   ```
   with
   ```js
       const n = this._n(ui);
       if (kind === 'long') {
         if (b === 'm' && ui.proposed && n > 0) {
           ui.go(shotMenu({ ui, index: this._index(ui, this.cursor), parent: this }));
         }
         return;
       }
       if (kind !== 'tap') return;
   ```
3. In `_list`, replace
   ```js
       const rows = [`SHOT # ${n - this.cursor}`, 'DIST AZM°INCL°'];
   ```
   with
   ```js
       const rows = [lr(`SHOT # ${n - this.cursor}`, ui.annotations.name(this._index(ui, this.cursor))), 'DIST AZM°INCL°'];
   ```
   and replace
   ```js
         const tail = (ui.isUnsent(i) ? '*' : ' ') + (v.mark !== NONE ? '_' : ' ');
   ```
   with
   ```js
         const tail = (ui.isUnsent(i) ? '*' : ' ') + (v.mark !== NONE || ui.annotations.tag(i) ? '_' : ' ');
   ```
4. In `_detail`, replace
   ```js
       const head = lr(`SHOT # ${n - this.cursor}`, ui.isUnsent(i) ? '*' : '');
   ```
   with
   ```js
       const head = lr(`SHOT # ${n - this.cursor}`, `${ui.annotations.name(i)}${ui.isUnsent(i) ? ' *' : ''}`.trim());
   ```
   and replace the last page body
   ```js
           lr('Mark:', MARKS[v.mark]),
         ];
   ```
   with
   ```js
           lr('Mark:', MARKS[v.mark]),
           ...(ui.annotations.tag(i) ? [lr('Tag:', calloutLabel(ui.content.callouts, ui.annotations.tag(i)))] : []),
         ];
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ui-shotmenu.test.js` then `npm test`
Expected: PASS, including all phase 1 measure and memory tests. If the `SHOT # 1 +S1` regex fails, print `r.text()` and check that `lr` puts the name flush right on row 0.

- [ ] **Step 5: Commit**

```bash
git add device/ui/screens/shotmenu.js device/ui/screens/measure.js device/ui/screens/memory.js test/ui-shotmenu.test.js
git commit -m "feat: shot menu, callout and station-name flows in the proposed profile"
```

---

### Task 5: Input recorder

**Goal:** An `InputRecorder` that counts taps, long presses and chords, hold time, keeps a log, and splits counts by labeled task.

**Files:**
- Create: `device/ui/recorder.js`
- Test: `test/recorder.test.js`

**Acceptance Criteria:**
- [ ] `record(event)` counts by kind: a plain button tap is a tap; a plain button long press is a long and adds its `heldMs` to hold time; any `+` button (`dist+m`, `left+right`) is a chord, adding `heldMs` when it is not a tap
- [ ] `presses` is `taps + longs + 2 * chords`
- [ ] `task(name)` starts a new bucket (the first call renames the initial empty bucket); `totals()` sums the buckets; `reset()` clears everything
- [ ] The log keeps the last `maxLog` events; `toText()` summarizes totals, tasks and the last events
- [ ] Hooked to a Ui through `ui.onInput`, it records real button presses with screen names

**Verify:** `node --test test/recorder.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/recorder.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputRecorder, presses } from '../device/ui/recorder.js';
import { rig } from './ui-helpers.js';

const ev = (button, kind, heldMs = 0, screen = 'X', t = 0) => ({ t, button, kind, heldMs, screen });

test('counts by kind and sums hold time', () => {
  const r = new InputRecorder();
  r.record(ev('dist', 'tap'));
  r.record(ev('m', 'tap'));
  r.record(ev('m', 'long', 1000));
  r.record(ev('dist+m', 'chord', 2100));
  r.record(ev('left+right', 'tap', 50));
  r.record(ev('left+right', 'long', 2000));
  const t = r.totals();
  assert.equal(t.taps, 2);
  assert.equal(t.longs, 1);
  assert.equal(t.chords, 3);
  assert.equal(t.holdMs, 1000 + 2100 + 2000);
  assert.equal(t.presses, 2 + 1 + 2 * 3);
  assert.equal(presses(t), t.presses);
});

test('tasks split the counts', () => {
  const r = new InputRecorder();
  r.record(ev('dist', 'tap'));
  r.task('First');
  r.record(ev('dist', 'tap'));
  r.record(ev('dist', 'tap'));
  r.task('Second');
  r.record(ev('m', 'long', 1000));
  assert.deepEqual(r.tasks.map((t) => [t.name, t.taps, t.longs]), [['First', 3, 0], ['Second', 0, 1]]);
  assert.equal(r.totals().taps, 3);
});

test('the first task() renames the empty starting bucket', () => {
  const r = new InputRecorder();
  r.task('Only');
  assert.deepEqual(r.tasks.map((t) => t.name), ['Only']);
  r.record(ev('dist', 'tap'));
  r.task('Next');
  assert.deepEqual(r.tasks.map((t) => t.name), ['Only', 'Next']);
});

test('reset and the log limit', () => {
  const r = new InputRecorder({ maxLog: 3 });
  for (let i = 0; i < 5; i++) r.record(ev('dist', 'tap', 0, 'X', i));
  assert.equal(r.events.length, 3);
  assert.equal(r.events[0].t, 2);
  assert.equal(r.totals().taps, 5, 'counts are not limited by the log');
  r.reset();
  assert.equal(r.totals().taps, 0);
  assert.equal(r.events.length, 0);
});

test('toText summarizes', () => {
  const r = new InputRecorder();
  r.task('Tag features');
  r.record(ev('dist', 'tap', 0, 'HomeScreen', 1000));
  r.record(ev('m', 'long', 1000, 'MeasureScreen', 2500));
  const text = r.toText();
  assert.match(text, /Presses: 2 \(taps 1, long 1, chords 0\)/);
  assert.match(text, /Hold: 1\.0 s/);
  assert.match(text, /Tag features: 2 presses/);
  assert.match(text, /long m +MeasureScreen/);
});

test('recording real presses through Ui.onInput', () => {
  const t = rig();
  const rec = new InputRecorder();
  t.ui.onInput = (e) => rec.record(e);
  t.tap('dist');
  t.tap('dist');
  t.hold('right', 2100);
  assert.equal(rec.totals().taps, 2);
  assert.equal(rec.totals().longs, 1);
  assert.equal(rec.events[0].screen, 'off');
  assert.equal(rec.events[1].screen, 'HomeScreen');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/recorder.test.js`
Expected: FAIL with `Cannot find module '../device/ui/recorder.js'`

- [ ] **Step 3: Write the implementation**

Create `device/ui/recorder.js`:

```js
// Counts button presses so flows can be compared by effort. Hook it up with
//   ui.onInput = (e) => recorder.record(e)
const newTask = (name) => ({ name, events: 0, taps: 0, longs: 0, chords: 0, holdMs: 0 });

// Button actuations: a chord is two buttons.
export const presses = (c) => c.taps + c.longs + c.chords * 2;

export class InputRecorder {
  constructor({ maxLog = 500 } = {}) {
    this.maxLog = maxLog;
    this.reset();
  }

  reset() {
    this.events = [];
    this.tasks = [newTask('Start')];
  }

  // Start counting into a new, named bucket. The first call renames the empty start bucket.
  task(name) {
    const cur = this.tasks.at(-1);
    if (cur.events === 0 && cur.name === 'Start') cur.name = name;
    else this.tasks.push(newTask(name));
  }

  record(e) {
    this.events.push(e);
    if (this.events.length > this.maxLog) this.events.shift();
    const t = this.tasks.at(-1);
    t.events++;
    if (e.button.includes('+')) {
      t.chords++;
      if (e.kind !== 'tap') t.holdMs += e.heldMs;
    } else if (e.kind === 'long') {
      t.longs++;
      t.holdMs += e.heldMs;
    } else t.taps++;
  }

  totals() {
    const sum = { taps: 0, longs: 0, chords: 0, holdMs: 0 };
    for (const t of this.tasks) for (const k of Object.keys(sum)) sum[k] += t[k];
    return { ...sum, presses: presses(sum) };
  }

  toText(logLines = 20) {
    const t = this.totals();
    const out = [
      `Presses: ${t.presses} (taps ${t.taps}, long ${t.longs}, chords ${t.chords})`,
      `Hold: ${(t.holdMs / 1000).toFixed(1)} s`,
    ];
    if (this.tasks.length > 1 || this.tasks[0].name !== 'Start') {
      for (const k of this.tasks) out.push(`${k.name}: ${presses(k)} presses (taps ${k.taps}, long ${k.longs}, chords ${k.chords})`);
    }
    const first = this.events[0]?.t ?? 0;
    out.push('', `Last ${Math.min(logLines, this.events.length)} inputs:`);
    for (const e of this.events.slice(-logLines)) {
      out.push(`+${((e.t - first) / 1000).toFixed(1)}s ${e.kind} ${e.button} ${e.screen}`);
    }
    return out.join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/recorder.test.js` then `npm test`
Expected: PASS. (`long m +MeasureScreen` in the `toText` test is matched with `+` as a regex quantifier on the space; if it fails, loosen the regex to `/long m\s+MeasureScreen/`.)

- [ ] **Step 5: Commit**

```bash
git add device/ui/recorder.js test/recorder.test.js
git commit -m "feat: input recorder with per-task counts"
```

---

### Task 6: Scenarios

**Goal:** A scenario runner that drives a throwaway X1 and Ui through high-level steps on stock and proposed, plus three built-in scenarios, a time estimate and a markdown report.

**Files:**
- Create: `device/ui/virtual-clock.js`, `device/ui/scenarios.js`
- Test: `test/scenarios.test.js`

**Acceptance Criteria:**
- [ ] `runScenario(scenario, profile, { content })` returns `{ scenario, profile, totals, tasks, shots, names, tags, marks, nameList }` and is deterministic
- [ ] Steps: `pose`, `tap`, `hold`, `wait`, `task`, `arm`, `take`, `shoot`, `callout`, `nameStation`, `cycleMark`, `tapBoth`, `repeat`; high-level steps read the real screens (they throw a clear error when a row or state is missing)
- [ ] Built-ins: `survey-stations`, `tag-features`, `survey-with-callouts`, each with stock and proposed variants
- [ ] Pinned counts (hand traced, see the test): survey-stations stock 61 taps, proposed 91 taps and 10 long presses with 10 000 ms hold and names `S1`..`S10`; tag-features stock 31 taps, proposed first three tasks 5, 7 and 8 taps with one long press each
- [ ] `estimateMs` follows the model; `toMarkdown` produces a table with both profiles

**Verify:** `node --test test/scenarios.test.js` → all pass

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `test/scenarios.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS, runScenario, compare, estimateMs, toMarkdown, DEFAULT_TIME_MODEL,
} from '../device/ui/scenarios.js';
import { PROPOSED, STOCK } from '../device/ui/profile.js';
import { parseCallouts } from '../device/ui/callouts.js';

const byId = (id) => SCENARIOS.find((s) => s.id === id);

test('survey 10 stations: hand-traced counts', () => {
  const sc = byId('survey-stations');
  const stock = runScenario(sc, STOCK);
  assert.equal(stock.shots, 30);
  // power-on tap, then arm + take for each of 30 shots, except the first arm shares the wake
  assert.equal(stock.totals.taps, 1 + 30 * 2);
  assert.equal(stock.totals.longs, 0);
  assert.equal(stock.names, 0);
  const prop = runScenario(sc, PROPOSED);
  // per station: long M, '>' to Name, M, DIST to accept
  assert.equal(prop.totals.taps, 61 + 10 * 3);
  assert.equal(prop.totals.longs, 10);
  assert.equal(prop.totals.holdMs, 10 * 1000);
  assert.equal(prop.names, 10);
  assert.deepEqual(prop.nameList[0], [2, 'S1']);
  assert.deepEqual(prop.nameList[9], [29, 'S10']);
  assert.equal(prop.tasks.length, 10);
});

test('tag 10 features: hand-traced first three tasks', () => {
  const sc = byId('tag-features');
  const stock = runScenario(sc, STOCK);
  assert.equal(stock.totals.taps, 4 + 9 * 3);
  assert.equal(stock.marks, 10);
  assert.deepEqual(stock.tasks.slice(0, 2).map((t) => t.taps), [4, 3]);
  const prop = runScenario(sc, PROPOSED);
  assert.deepEqual(prop.tasks.slice(0, 3).map((t) => [t.taps, t.longs]), [[5, 1], [7, 1], [8, 1]]);
  assert.equal(prop.totals.longs, 10);
  assert.equal(prop.tags, 10);
  assert.equal(prop.marks, 0);
});

test('survey with callouts: both profiles complete, proposed does more', () => {
  const sc = byId('survey-with-callouts');
  const stock = runScenario(sc, STOCK);
  const prop = runScenario(sc, PROPOSED);
  assert.equal(stock.shots, 30);
  assert.equal(prop.shots, 30);
  assert.equal(stock.marks, 10);
  assert.equal(prop.names, 10);
  assert.equal(prop.tags, 10);
  assert.ok(prop.totals.presses > stock.totals.presses);
});

test('runs are deterministic', () => {
  const sc = byId('survey-with-callouts');
  assert.deepEqual(runScenario(sc, PROPOSED), runScenario(sc, PROPOSED));
});

test('custom content is used and a missing callout is a clear error', () => {
  const sc = byId('tag-features');
  const content = { callouts: parseCallouts('Water: Splash').categories, namePrefix: 'S', nameFirst: 1 };
  assert.throws(() => runScenario(sc, PROPOSED, { content }), /No callout Water > Drip/);
});

test('both-arrows step is counted as one chord', () => {
  const sc = { id: 't', name: 't', description: '', variants: { stock: () => [{ tap: 'dist' }, { tapBoth: true }], proposed: () => [] } };
  const r = runScenario(sc, STOCK);
  assert.equal(r.totals.chords, 1);
  assert.equal(r.totals.taps, 1);
  assert.equal(r.totals.presses, 3);
});

test('estimateMs follows the time model', () => {
  const r = { totals: { taps: 10, longs: 2, chords: 0, holdMs: 2000 }, shots: 5 };
  assert.equal(estimateMs(r), 10 * 600 + 2 * 400 + 2000 + 5 * 2000);
  assert.equal(estimateMs(r, { tapMs: 1000, longExtraMs: 0, shotMs: 0 }), 12000);
  assert.deepEqual(Object.keys(DEFAULT_TIME_MODEL).sort(), ['longExtraMs', 'shotMs', 'tapMs']);
});

test('toMarkdown lists both profiles for each scenario', () => {
  const md = toMarkdown([compare(byId('tag-features'))]);
  assert.match(md, /\| Scenario \| Profile \|/);
  assert.match(md, /Tag 10 features/);
  assert.match(md, /stock-1\.1\.7/);
  assert.match(md, /proposed/);
  assert.match(md, /Est\. time/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scenarios.test.js`
Expected: FAIL with `Cannot find module '../device/ui/scenarios.js'`

- [ ] **Step 3: Write the implementation**

Create `device/ui/virtual-clock.js`:

```js
// A clock that only moves when told, for running scripts without waiting.
export class VirtualClock {
  constructor(start = 1_700_000_000_000) {
    this.t = start;
    this.now = () => this.t;
  }

  advance(ms) { this.t += ms; }
}
```

Create `device/ui/scenarios.js`:

```js
// Scripted cave-trip scenarios, run on stock and proposed to compare effort.
import { X1 } from '../x1.js';
import { Ui } from './ui.js';
import { InputRecorder } from './recorder.js';
import { VirtualClock } from './virtual-clock.js';
import { PROPOSED, STOCK, longMs } from './profile.js';
import { calloutCode, calloutLabel } from './callouts.js';

// ---- running -------------------------------------------------------------------
function makeCtx(profile, content) {
  const clock = new VirtualClock();
  const x1 = new X1({ now: clock.now });
  const ui = new Ui({ x1, profile, content: content ?? null });
  const rec = new InputRecorder();
  ui.onInput = (e) => rec.record(e);
  const ctx = { clock, x1, ui, rec, profile };
  ctx.advance = (ms) => {
    for (let left = ms; left > 0; left -= 100) {
      clock.advance(Math.min(100, left));
      ui.tick();
    }
  };
  ctx.tap = (b) => { ui.press(b); ui.release(b); ctx.advance(50); };
  ctx.hold = (b, ms) => { ui.press(b); ctx.advance(ms); ui.release(b); ctx.advance(50); };
  ctx.tapBoth = () => { ui.press('left'); ui.press('right'); ui.release('left'); ui.release('right'); ctx.advance(50); };
  return ctx;
}

const isArmed = (ui) => ui.screen?.constructor.name === 'MeasureScreen' && ui.screen.result === null;
const hasResult = (ui) => ui.screen?.constructor.name === 'MeasureScreen' && ui.screen.result !== null;

function arm(ctx) {
  if (!ctx.ui.on) ctx.tap('dist');
  if (isArmed(ctx.ui)) return;
  ctx.tap('dist');
  if (!isArmed(ctx.ui)) throw new Error('Could not arm the laser');
}

function take(ctx) {
  if (!isArmed(ctx.ui)) throw new Error('take needs the laser armed');
  ctx.tap('dist');
  if (isArmed(ctx.ui)) throw new Error('The shot was not taken');
}

// Move the '>' cursor to the row whose label starts with `label`, scrolling if needed.
function goto(ctx, label) {
  for (let guard = 0; guard < 60; guard++) {
    const rows = ctx.ui.scene().rows;
    const cur = rows.findIndex((r) => r.startsWith('> '));
    const target = rows.findIndex((r) => /^(> | {2})/.test(r) && r.slice(2).trim().startsWith(label));
    if (cur < 0) throw new Error(`No cursor on screen looking for "${label}":\n${rows.join('\n')}`);
    if (target < 0) { ctx.tap('right'); continue; } // not in view yet: scroll down
    if (cur === target) return;
    ctx.tap(target > cur ? 'right' : 'left');
  }
  throw new Error(`Could not reach "${label}"`);
}

// Pick a callout, using the cheaper of the Recent list and the category path.
function pick(ctx, [category, item]) {
  const cats = ctx.ui.content.callouts;
  const cat = cats.findIndex((c) => c.name === category);
  const it = cat < 0 ? -1 : cats[cat].items.indexOf(item);
  if (cat < 0 || it < 0) throw new Error(`No callout ${category} > ${item}`);
  const code = calloutCode(cat, it);
  const recent = ctx.ui.annotations.recent.filter((c) => calloutLabel(cats, c));
  const rPos = recent.indexOf(code);
  const catRow = (recent.length ? 1 : 0) + cat;
  if (rPos >= 0 && rPos <= catRow + it) {
    goto(ctx, 'Recent'); ctx.tap('m'); goto(ctx, item); ctx.tap('m');
  } else {
    goto(ctx, category); ctx.tap('m'); goto(ctx, item); ctx.tap('m');
  }
}

function callout(ctx, path) {
  const wasArmed = isArmed(ctx.ui);
  if (!wasArmed && !hasResult(ctx.ui)) throw new Error('callout needs the measure screen');
  ctx.hold('m', longMs(ctx.profile, 'm'));
  if (!wasArmed) { goto(ctx, 'Callout'); ctx.tap('m'); }
  pick(ctx, path);
}

function nameStation(ctx) {
  if (!hasResult(ctx.ui)) throw new Error('nameStation needs a shot result on screen');
  ctx.hold('m', longMs(ctx.profile, 'm'));
  goto(ctx, 'Name');
  ctx.tap('m');
  ctx.tap('dist'); // accept the suggested name
}

function cycleMark(ctx, label) {
  if (!isArmed(ctx.ui)) throw new Error('cycleMark needs the laser armed');
  for (let i = 0; i < 6; i++) {
    ctx.tap('m');
    if (ctx.ui.scene().rows.some((r) => r.includes(label))) return;
  }
  throw new Error(`Mark "${label}" never appeared`);
}

function exec(ctx, steps) {
  for (const s of steps) {
    if ('task' in s) ctx.rec.task(s.task);
    else if ('pose' in s) Object.assign(ctx.ui.instrument.pose, s.pose);
    else if ('tap' in s) ctx.tap(s.tap);
    else if ('hold' in s) ctx.hold(s.hold, s.ms);
    else if ('wait' in s) ctx.advance(s.wait);
    else if ('tapBoth' in s) ctx.tapBoth();
    else if ('arm' in s) arm(ctx);
    else if ('take' in s) take(ctx);
    else if ('shoot' in s) { arm(ctx); take(ctx); }
    else if ('callout' in s) callout(ctx, s.callout);
    else if ('nameStation' in s) nameStation(ctx);
    else if ('cycleMark' in s) cycleMark(ctx, s.cycleMark);
    else if ('repeat' in s) for (let i = 0; i < s.repeat; i++) exec(ctx, s.steps(i));
    else throw new Error(`Unknown step ${JSON.stringify(s)}`);
  }
}

export function runScenario(scenario, profile, { content } = {}) {
  const ctx = makeCtx(profile, content);
  const variant = profile === PROPOSED ? 'proposed' : 'stock';
  exec(ctx, scenario.variants[variant](ctx.ui.content));
  const shots = ctx.x1.memory.shots;
  return {
    scenario: scenario.id,
    profile,
    totals: ctx.rec.totals(),
    tasks: ctx.rec.tasks.map((t) => ({ ...t })),
    shots: shots.length,
    names: ctx.ui.annotations.names.size,
    tags: ctx.ui.annotations.tags.size,
    marks: shots.filter((r) => ((r[1] >> 1) & 7) !== 7).length,
    nameList: [...ctx.ui.annotations.names.entries()].sort((a, b) => a[0] - b[0]),
  };
}

export function compare(scenario, opts = {}) {
  return { scenario, stock: runScenario(scenario, STOCK, opts), proposed: runScenario(scenario, PROPOSED, opts) };
}

// ---- reporting -----------------------------------------------------------------
// A rough human-speed model. Counts are exact; times are only a guide.
export const DEFAULT_TIME_MODEL = { tapMs: 600, longExtraMs: 400, shotMs: 2000 };

export function estimateMs(r, m = DEFAULT_TIME_MODEL) {
  const t = r.totals;
  return t.taps * m.tapMs + t.longs * m.longExtraMs + t.holdMs + r.shots * m.shotMs;
}

export function toMarkdown(comparisons, model = DEFAULT_TIME_MODEL) {
  const lines = [
    '| Scenario | Profile | Presses | Taps | Long | Chords | Hold | Est. time | Names | Callouts |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of comparisons) {
    for (const r of [c.stock, c.proposed]) {
      const t = r.totals;
      lines.push(`| ${c.scenario.name} | ${r.profile} | ${t.presses} | ${t.taps} | ${t.longs} | ${t.chords} | ${(t.holdMs / 1000).toFixed(1)} s | ${(estimateMs(r, model) / 1000).toFixed(0)} s | ${r.names} | ${r.tags} |`);
    }
  }
  lines.push('', `Est. time model: ${model.tapMs} ms per tap, ${model.longExtraMs} ms extra per long press plus its hold, ${model.shotMs} ms per shot. Counts are exact; times are a rough guide.`);
  return lines.join('\n');
}

// ---- built-in scenarios --------------------------------------------------------
const STATIONS = 10;
const stationPose = (i) => ({ az: (20 + i * 31) % 360, inc: (i % 5) * 3 - 6, dist: 3 + (i % 4) });
const FEATURES = [['Water', 'Drip'], ['Passage', 'Squeeze'], ['Hazard', 'Loose']];
const CALLOUT_CYCLE = [['Water', 'Drip'], ['Calcite', 'Straw'], ['Passage', 'Crawl'], ['Hazard', 'Loose']];

export const SCENARIOS = [
  {
    id: 'survey-stations',
    name: 'Survey 10 stations',
    description: 'Three close shots per leg, ten legs. Proposed also names each station (suggested names accepted).',
    variants: {
      stock: () => [{
        repeat: STATIONS,
        steps: (i) => [{ task: `Station ${i + 1}` }, { pose: stationPose(i) }, { shoot: true }, { shoot: true }, { shoot: true }],
      }],
      proposed: () => [{
        repeat: STATIONS,
        steps: (i) => [{ task: `Station ${i + 1}` }, { pose: stationPose(i) }, { shoot: true }, { shoot: true }, { shoot: true }, { nameStation: true }],
      }],
    },
  },
  {
    id: 'tag-features',
    name: 'Tag 10 features',
    description: 'Ten shots, each marked. Stock cycles the Feature mark; proposed picks a callout (rotating through three).',
    variants: {
      stock: () => [{
        repeat: 10,
        steps: (i) => [{ task: `Feature ${i + 1}` }, { pose: stationPose(i) }, { arm: true }, { cycleMark: 'Feature' }, { take: true }],
      }],
      proposed: () => [{
        repeat: 10,
        steps: (i) => [{ task: `Feature ${i + 1}` }, { pose: stationPose(i) }, { arm: true }, { callout: FEATURES[i % FEATURES.length] }, { take: true }],
      }],
    },
  },
  {
    id: 'survey-with-callouts',
    name: 'Survey with callouts',
    description: 'Ten stations. The third shot of each carries a mark (stock: Feature) or a callout (proposed), and proposed names the station.',
    variants: {
      stock: () => [{
        repeat: STATIONS,
        steps: (i) => [
          { task: `Station ${i + 1}` }, { pose: stationPose(i) }, { shoot: true }, { shoot: true },
          { arm: true }, { cycleMark: 'Feature' }, { take: true },
        ],
      }],
      proposed: () => [{
        repeat: STATIONS,
        steps: (i) => [
          { task: `Station ${i + 1}` }, { pose: stationPose(i) }, { shoot: true }, { shoot: true },
          { arm: true }, { callout: CALLOUT_CYCLE[i % CALLOUT_CYCLE.length] }, { take: true }, { nameStation: true },
        ],
      }],
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scenarios.test.js` then `npm test`
Expected: PASS. If a pinned number differs, re-trace before changing it:
- Stock `survey-stations`: 1 wake tap, then 2 taps per shot (arm, take) for 30 shots, minus nothing: the first shot costs wake + arm + take = 3, the other 29 cost 2 each, total 61.
- Proposed adds per station 1 long press (1 000 ms hold) and 3 taps (`>` to Name, `M`, `DIST`), total 91 taps.
- `tag-features` stock: first feature 4 taps (wake, arm, `M`, take), later ones 3.
- `tag-features` proposed: feature 1 is wake + arm + picker `M` (Water, cursor already there) + `M` (Drip) + take = 5; feature 2 (Passage > Squeeze, `Recent` row exists so Passage is row 3) is arm + 3 `>` + `M` + `M` + take = 7; feature 3 (Hazard > Loose, row 4) is arm + 4 `>` + `M` + `M` + take = 8.

- [ ] **Step 5: Commit**

```bash
git add device/ui/virtual-clock.js device/ui/scenarios.js test/scenarios.test.js
git commit -m "feat: scenario runner with built-in survey and tagging comparisons"
```

---

### Task 7: Panel: B button, profile switch, counters, scenarios, callout editor

**Goal:** The panel front face gets the B button and key, and new cards: profile switch, press counters, scenario results, and a callout editor.

**Files:**
- Modify: `panel/keys.js`, `panel/face.js`, `panel/panel.html`, `panel/panel.css`, `panel/panel.js`
- Create: `panel/preview.js`
- Test: `test/face-keys.test.js` (extend)

**Acceptance Criteria:**
- [ ] `KEYMAP` maps `b` and `B` to `both`; a `B` button on the face and the `B` key press `<` and `>` together and release them together (also on blur)
- [ ] A profile select switches the Ui (powering it off) and is remembered
- [ ] The counters card shows presses, taps, long presses, chords and hold, a log of recent inputs, a task-label box with a "New task" button, Reset and "Copy as text"
- [ ] The scenarios card runs one or all scenarios (using the current callout content), shows stock and proposed side by side with per-task detail, and copies a markdown report
- [ ] The callout editor shows the content as text, validates (errors listed, previous content kept), applies, and is remembered; name prefix and first number are editable
- [ ] "Clear shots" and the factory reset also clear annotations

**Verify:** `node --test test/face-keys.test.js` then `npm test`, then the manual browser check in Step 5.

**Steps:**

- [ ] **Step 1: Extend the failing test**

Append to `test/face-keys.test.js`:

```js

test('the B key presses both arrows', () => {
  assert.equal(KEYMAP.b, 'both');
  assert.equal(KEYMAP.B, 'both');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/face-keys.test.js`
Expected: FAIL (`undefined !== 'both'`).

- [ ] **Step 3: Write the implementation**

`panel/keys.js`: add two entries to `KEYMAP`:

```js
  b: 'both',
  B: 'both',
```

`panel/face.js`: add a helper after the imports and use it for pointer and keyboard presses. After the line `const FG = '#1f2a10';` add:

```js
// The B button is both arrows at once.
const EXPAND = { both: ['left', 'right'] };
const buttonsOf = (name) => EXPAND[name] ?? [name];
```

Replace the pointer wiring block

```js
  for (const el of root.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.press(b); draw(); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, () => { ui.release(b); draw(); });
    }
  }
```

with

```js
  for (const el of root.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); for (const x of buttonsOf(b)) ui.press(x); draw(); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, () => { for (const x of buttonsOf(b)) ui.release(x); draw(); });
    }
  }
```

In the `keydown` handler replace `ui.press(b);` (the one right after `held.add(b);`) with `for (const x of buttonsOf(b)) ui.press(x);`. In the `keyup` handler replace `ui.release(b);` with `for (const x of buttonsOf(b)) ui.release(x);`. In the `blur` handler replace `for (const b of held) ui.release(b);` with `for (const b of held) for (const x of buttonsOf(b)) ui.release(x);`.

`panel/panel.html`: in the face card, replace `<h2>Front face</h2>` with

```html
  <h2>Front face</h2>
  <label class="check">Firmware profile
    <select id="selProfile">
      <option value="stock-1.1.7">Stock 1.1.7</option>
      <option value="proposed">Proposed</option>
    </select>
  </label>
```

and replace the line `<button data-btn="clr">CLR</button>` with

```html
    <button data-btn="clr">CLR</button>
    <button data-btn="both" title="Both arrows at once (key: B)">B</button>
```

and change the hint line to `Keys: Space = DIST, arrows, M, Esc = CLR, B = both arrows. Hold DIST 2 s for a delayed shot. In the proposed profile hold M 1 s.`

Insert these cards immediately before the card that contains `<h2>Firmware</h2>`:

```html
<section class="card" id="counts">
  <h2>Press counter</h2>
  <dl class="kv">
    <dt>Presses</dt><dd id="cntPresses">0</dd>
    <dt>Taps</dt><dd id="cntTaps">0</dd>
    <dt>Long presses</dt><dd id="cntLongs">0</dd>
    <dt>Chords</dt><dd id="cntChords">0</dd>
    <dt>Hold time</dt><dd id="cntHold">0.0 s</dd>
  </dl>
  <div class="row wrap">
    <input id="inTask" class="grow" type="text" placeholder="Task label" aria-label="Task label">
    <button id="btnTask" class="ghost">New task</button>
    <button id="btnCountReset" class="ghost">Reset</button>
    <button id="btnCountCopy" class="ghost">Copy as text</button>
  </div>
  <div id="taskList" class="tasks"></div>
  <pre id="cntLog" class="log" aria-live="off"></pre>
</section>

<section class="card" id="scenarios">
  <h2>Scenarios</h2>
  <p class="hint">Runs each flow on stock and proposed with the current callout list. Counts are exact; times use a rough model.</p>
  <div class="row wrap">
    <select id="selScenario" aria-label="Scenario"></select>
    <button id="btnRun" class="ghost">Run</button>
    <button id="btnRunAll" class="ghost">Run all</button>
    <button id="btnScenarioCopy" class="ghost">Copy as markdown</button>
  </div>
  <p id="scenarioDesc" class="hint"></p>
  <div id="scenarioOut"></div>
</section>

<section class="card" id="calloutCard">
  <h2>Callout menu</h2>
  <p class="hint">One category per line: <code>Category: item, item</code>. Up to 8 categories of 8 items, names up to 8 characters.</p>
  <textarea id="calloutText" rows="7" spellcheck="false" aria-label="Callout menu content"></textarea>
  <div class="grid2">
    <label>Name prefix<input id="namePrefix" type="text" maxlength="6"></label>
    <label>First number<input id="nameFirst" type="number" min="0" step="1"></label>
  </div>
  <p id="calloutErrors" class="errors" role="alert"></p>
  <div class="row"><button id="btnCalloutApply" class="ghost">Apply</button><button id="btnCalloutDefault" class="ghost">Reset to default</button></div>
</section>
```

`panel/panel.css`: append

```css
.grow { flex: 1; min-width: 0; }
textarea { width: 100%; box-sizing: border-box; font: 12px/1.4 ui-monospace, Menlo, monospace; }
.errors { color: #e07a7a; font-size: 12px; margin: 4px 0; white-space: pre-line; }
.errors:empty { display: none; }
.tasks { font-size: 12px; margin: 6px 0; }
table.cmp { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; }
table.cmp th, table.cmp td { text-align: right; padding: 2px 6px; border-bottom: 1px solid rgba(128,128,128,.3); }
table.cmp th:first-child, table.cmp td:first-child { text-align: left; }
```

Create `panel/preview.js`:

```js
// Panel pieces for judging the proposed interface: profile switch, press counter,
// scenario comparison and the callout editor.
import { STOCK } from '../device/ui/profile.js';
import { InputRecorder, presses } from '../device/ui/recorder.js';
import { parseCallouts, DEFAULT_CALLOUT_TEXT } from '../device/ui/callouts.js';
import { SCENARIOS, compare, toMarkdown, estimateMs } from '../device/ui/scenarios.js';

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

export async function mountPreview({ ui, root, store, note }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const saved = await store.get(['profile', 'content']);

  // ---- profile -------------------------------------------------------------
  const rec = new InputRecorder();
  ui.onInput = (e) => rec.record(e);
  const sel = $('selProfile');
  sel.value = saved.profile ?? STOCK;
  ui.setProfile(sel.value);
  sel.addEventListener('change', () => {
    ui.setProfile(sel.value);
    rec.reset();
    store.set({ profile: sel.value });
    note(`Profile: ${sel.value} (the X1 was powered off)`);
  });

  // ---- callout content -----------------------------------------------------
  const content = saved.content ?? { text: DEFAULT_CALLOUT_TEXT, prefix: 'S', first: 1 };
  $('calloutText').value = content.text;
  $('namePrefix').value = content.prefix;
  $('nameFirst').value = content.first;
  function apply() {
    const text = $('calloutText').value;
    const r = parseCallouts(text);
    $('calloutErrors').textContent = r.errors.join('\n');
    if (!r.ok) return false;
    const prefix = $('namePrefix').value.trim() || 'S';
    const first = Math.max(0, Math.floor(Number($('nameFirst').value) || 0));
    ui.content = { callouts: r.categories, namePrefix: prefix, nameFirst: first };
    store.set({ content: { text, prefix, first } });
    note('Callout menu applied');
    return true;
  }
  $('btnCalloutApply').addEventListener('click', apply);
  $('btnCalloutDefault').addEventListener('click', () => {
    $('calloutText').value = DEFAULT_CALLOUT_TEXT;
    $('namePrefix').value = 'S';
    $('nameFirst').value = 1;
    apply();
  });
  apply();

  // ---- press counter -------------------------------------------------------
  function drawCounts() {
    const t = rec.totals();
    $('cntPresses').textContent = t.presses;
    $('cntTaps').textContent = t.taps;
    $('cntLongs').textContent = t.longs;
    $('cntChords').textContent = t.chords;
    $('cntHold').textContent = `${(t.holdMs / 1000).toFixed(1)} s`;
    const list = $('taskList');
    list.replaceChildren();
    if (rec.tasks.length > 1 || rec.tasks[0].name !== 'Start') {
      for (const k of rec.tasks) list.append(el('div', `${k.name}: ${presses(k)} presses`));
    }
    const first = rec.events[0]?.t ?? 0;
    $('cntLog').textContent = rec.events.slice(-12)
      .map((e) => `+${((e.t - first) / 1000).toFixed(1)}s ${e.kind} ${e.button} ${e.screen}`).join('\n');
  }
  setInterval(drawCounts, 300);
  $('btnTask').addEventListener('click', () => {
    const name = $('inTask').value.trim() || `Task ${rec.tasks.length + 1}`;
    rec.task(name);
    $('inTask').value = '';
    drawCounts();
  });
  $('btnCountReset').addEventListener('click', () => { rec.reset(); drawCounts(); });
  $('btnCountCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(rec.toText());
    note('Press counts copied');
  });

  // ---- scenarios -----------------------------------------------------------
  const sc = $('selScenario');
  for (const s of SCENARIOS) sc.append(Object.assign(el('option', s.name), { value: s.id }));
  const showDesc = () => { $('scenarioDesc').textContent = SCENARIOS.find((s) => s.id === sc.value)?.description ?? ''; };
  sc.addEventListener('change', showDesc);
  showDesc();
  let last = [];

  function table(c) {
    const wrap = el('div');
    wrap.append(el('strong', c.scenario.name));
    const t = el('table', undefined, 'cmp');
    const head = el('tr');
    for (const h of ['Profile', 'Presses', 'Taps', 'Long', 'Hold', 'Est.', 'Names', 'Callouts']) head.append(el('th', h));
    t.append(head);
    for (const r of [c.stock, c.proposed]) {
      const x = r.totals;
      const row = el('tr');
      for (const v of [r.profile, x.presses, x.taps, x.longs, `${(x.holdMs / 1000).toFixed(1)} s`, `${(estimateMs(r) / 1000).toFixed(0)} s`, r.names, r.tags]) row.append(el('td', String(v)));
      t.append(row);
    }
    wrap.append(t);
    const details = el('details');
    details.append(el('summary', 'Per task (presses, stock / proposed)'));
    c.stock.tasks.forEach((k, i) => details.append(el('div', `${k.name}: ${presses(k)} / ${presses(c.proposed.tasks[i])}`)));
    wrap.append(details);
    return wrap;
  }

  function run(list) {
    try {
      last = list.map((s) => compare(s, { content: ui.content }));
    } catch (e) {
      $('scenarioOut').replaceChildren(el('p', `Scenario failed: ${e.message}`, 'errors'));
      return;
    }
    $('scenarioOut').replaceChildren(...last.map(table));
  }
  $('btnRun').addEventListener('click', () => run([SCENARIOS.find((s) => s.id === sc.value)]));
  $('btnRunAll').addEventListener('click', () => run(SCENARIOS));
  $('btnScenarioCopy').addEventListener('click', async () => {
    if (!last.length) { note('Run a scenario first'); return; }
    await navigator.clipboard.writeText(toMarkdown(last));
    note('Scenario results copied as markdown');
  });
}
```

`panel/panel.js`: add the import `import { mountPreview } from './preview.js';` next to the other imports; after the `mountFace({ ... })` line add `await mountPreview({ ui, root: document, store, note });`; in the `btnClearShots` click handler add `ui.annotations.clear();` after `x1.memory.shots = [];`; in the factory-reset handler (after `x1.factoryReset();`) add `ui.resetState();`.

If `ui` is created after something that calls `render()` before it exists (a `ReferenceError`), move `const ui = new Ui({ x1 });` to just after `const x1 = makeX1(saved.device);` and keep `ui.instrument.onLive = ...` where it is.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/face-keys.test.js` then `npm test`
Expected: PASS. Also run `node --check panel/preview.js panel/face.js panel/panel.js`.

- [ ] **Step 5: Verify in the browser (manual)**

Run: `node dev/serve.mjs 8123` and open `http://localhost:8123/ext/panel/panel.html`.

Check, in order:
1. Switch "Firmware profile" to Proposed. Press Space (wake), Space (arm), hold `M` for about a second: the screen shows `CALLOUT` with a `> Water` cursor. Press `M`, `M`: back on the measure screen with `Tag: Drip`. Press Space to take the shot: the result shows `Tag: Drip`.
2. Hold `M` for a second again: the shot menu shows Callout, Name, Mark, Delete shot. Press `>` then `M`: the name editor shows `S1[0]`. Press Space: the result shows `Stn: S1`.
3. Click the on-screen `B` button, and press the `B` key: nothing visible changes on any screen (expected: no screen uses it yet), but "Chords" in the Press counter goes up by one each time and the log shows `tap left+right`.
4. The Press counter shows the presses so far; type a label and click "New task"; click "Copy as text" (the traffic log notes it).
5. In Scenarios click "Run all": three tables appear with stock and proposed rows; open "Per task". Survey 10 stations shows stock 61 taps and proposed 91 taps. Click "Copy as markdown".
6. Edit the callout text (add `Gear: Rope, Ladder` as a seventh line), click Apply: the picker now lists Gear. Put a name of 9 characters in a line and click Apply: an error appears and the previous menu stays.
7. Reload the page: the profile and callout text are remembered.

Expected: all seven behave as described.

- [ ] **Step 6: Commit**

```bash
git add panel/keys.js panel/face.js panel/panel.html panel/panel.css panel/panel.js panel/preview.js test/face-keys.test.js
git commit -m "feat: panel B button, profile switch, press counter, scenarios and callout editor"
```

---

### Task 8: Documentation

**Goal:** README documents the proposed profile and the tools; the parent spec reflects the refocus.

**Files:**
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] README has a "Proposed profile preview" section covering the switch, the two flows, the B button, the counter, scenarios and the callout editor, and what is a guess
- [ ] The old sentence saying the BLE link and the proposed callout and name features are not built yet is replaced

**Verify:** `grep -n "Proposed profile preview" README.md && npm test` → one heading and all tests pass

**Steps:**

- [ ] **Step 1: Edit README**

In `README.md`, replace the sentence `The BLE link and the proposed callout and name features are not built yet.` (end of the "Front face (UI model)" section) with `The proposed callout and name features are described next. A Bluetooth link is not planned: the emulator is a design tool.`

Append:

```markdown
## Proposed profile preview

The front face has a "Firmware profile" switch: stock 1.1.7 or proposed. Switching
powers the X1 off and clears callouts and names. Tags and names live only in the
UI model, not in shot records.

Proposed flows:
- **Callout.** With the laser armed, hold M for 1 s: pick a category, then an item
  (`<` `>` move, `M` selects, `CLR` goes back). The next shot gets the callout. The
  last three used callouts appear first under `Recent`.
- **Shot menu.** After a shot, or in memory mode, hold M for 1 s: Callout, Name, Mark,
  Delete shot (last shot only).
- **Station name.** `<` `>` scroll 0-9, A-Z, `-`, `.` and `OK`, `M` adds the character,
  `CLR` deletes, `DIST` accepts, long `CLR` cancels. The suggested name is the previous
  one plus one (A12 to A13), or the prefix plus the first number.
- **B button.** Presses `<` and `>` together (key `B`). No screen uses it yet; it is
  counted as a two-button chord.

Tools for judging the flows:
- **Press counter.** Taps, long presses, chords, hold time, a log, and task labels,
  with "Copy as text".
- **Scenarios.** Replayable cave-trip scripts run on stock and proposed with exact
  press counts and a rough time estimate; "Copy as markdown" for sharing.
- **Callout menu.** Edit categories and items (up to 8 by 8, names up to 8
  characters), the name prefix and the first number.

Guessed: the 1 s long press for M, using a long M after a shot as the shot menu (the
real 1.1.7 shot menu may open differently), the stock steps in each scenario, and the
time model. A slow M tap (held 1 s or more) becomes a long press in the proposed
profile, which is part of what is being tested.
```

- [ ] **Step 2: Verify**

Run: `grep -n "Proposed profile preview" README.md && npm test`
Expected: one heading line, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the proposed profile preview and its tools"
```

---

## Self-review

**Spec coverage:**
- Profile switch and long-press changes: Tasks 1-2. Both-arrows button: Task 2 (Ui input), Task 5 (counting), Task 6 (`tapBoth` step), Task 7 (button and key).
- Callout picker, shot menu, name editor, display in measure and memory mode: Tasks 3-4.
- Press counting with task markers, copy as text: Tasks 5 and 7.
- Scenarios (three built-ins, side-by-side, per-task, markdown, time model): Tasks 6-7.
- Editable menu content with validation and persistence: Tasks 1 (parse) and 7 (panel).
- Annotations clear on profile switch, factory reset, Clear shots: Tasks 2 and 7.
- Documentation and the stated risks: Task 8, spec.
- Not covered by design: hold-to-repeat scrolling and alternative name layouts (spec lists them as later experiments).

**Placeholder scan:** The two "clean-up while writing the file" notes in Tasks 1, 2 and 4 name the exact lines to change. No TBD or "implement later".

**Type consistency:** `Ui.onInput` payload `{ t, button, kind, heldMs, screen }` is used the same in Tasks 2, 5, 6. `ui.annotations` methods (`tag`, `setTag`, `name`, `setName`, `drop`, `recent`, `suggestName`, `clear`) match across Tasks 1, 3, 4, 6. `ui.content` is `{ callouts, namePrefix, nameFirst }` everywhere. Screen constructors: `PickerScreen({ onPick, onCancel })`, `NameEditScreen({ initial, onDone, onCancel })`, `shotMenu({ ui, index, parent })`. Scenario step names match between `exec` and the built-ins.

**Not executed:** the code in this plan has not been run. Expect small fixes (regex spacing, a row index), as in phase 1. The hand-traced counts in Task 6 are the strongest check on the flows; if they fail, trace the flow before editing the numbers.
