// Scripted cave-trip scenarios, run on stock and proposed to compare effort.
import { X1 } from '../x1.js';
import { Ui } from './ui.js';
import { InputRecorder } from './recorder.js';
import { VirtualClock } from './virtual-clock.js';
import { PROPOSED, STOCK, longMs } from './profile.js';

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

// A row matches when its text is exactly the label, or the label followed by a value column.
const sameLabel = (text, label) => text.trim() === label || text.startsWith(`${label}  `);

// Move the '>' cursor to the row labelled `label`, scrolling down if it is not in view.
// (It only scrolls down: every caller starts at the top of a list.)
function goto(ctx, label) {
  for (let guard = 0; guard < 60; guard++) {
    const rows = ctx.ui.scene().rows;
    const cur = rows.findIndex((r) => r.startsWith('> '));
    const target = rows.findIndex((r) => /^(> | {2})/.test(r) && sameLabel(r.slice(2), label));
    if (cur < 0) throw new Error(`No cursor on screen looking for "${label}":\n${rows.join('\n')}`);
    if (target < 0) { ctx.tap('right'); continue; } // not in view yet: scroll down
    if (cur === target) return;
    ctx.tap(target > cur ? 'right' : 'left');
  }
  throw new Error(`Could not reach "${label}"`);
}

// Pick a callout from the flat list: go to its row, select it.
function pick(ctx, name) {
  if (!ctx.ui.content.callouts.includes(name)) throw new Error(`No callout ${name}`);
  goto(ctx, name);
  ctx.tap('m');
}

// via 'm' (default): hold M, then through the shot menu after a shot. via 'both': the B button.
function callout(ctx, name, via = 'm') {
  const wasArmed = isArmed(ctx.ui);
  if (!wasArmed && !hasResult(ctx.ui)) throw new Error('callout needs the measure screen');
  if (via === 'both') ctx.tapBoth();
  else {
    ctx.hold('m', longMs(ctx.profile, 'm'));
    if (!wasArmed) { goto(ctx, 'Callout'); ctx.tap('m'); }
  }
  pick(ctx, name);
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

const BUTTONS = ['dist', 'm', 'left', 'right', 'clr'];
const isMs = (v) => typeof v === 'number' && v >= 0 && Number.isFinite(v);

function checkStep(s) {
  const keys = Object.keys(s);
  const ok = keys.length === 1 || (keys.length === 2 && (('hold' in s && 'ms' in s) || ('repeat' in s && 'steps' in s) || ('callout' in s && 'via' in s)));
  if (!ok) throw new Error(`A step has one action (hold needs ms, repeat needs steps): ${JSON.stringify(s)}`);
  if ('tap' in s && !BUTTONS.includes(s.tap)) throw new Error(`Unknown button "${s.tap}"`);
  if ('hold' in s && (!BUTTONS.includes(s.hold) || !isMs(s.ms))) throw new Error(`hold needs a button and ms: ${JSON.stringify(s)}`);
  if ('wait' in s && !isMs(s.wait)) throw new Error(`wait needs milliseconds: ${JSON.stringify(s)}`);
  if ('repeat' in s && !(Number.isInteger(s.repeat) && typeof s.steps === 'function')) throw new Error('repeat needs a count and a steps(i) function');
}

function exec(ctx, steps) {
  for (const s of steps) {
    checkStep(s);
    if ('task' in s) ctx.rec.task(s.task);
    else if ('pose' in s) Object.assign(ctx.ui.instrument.pose, s.pose);
    else if ('tap' in s) ctx.tap(s.tap);
    else if ('hold' in s) ctx.hold(s.hold, s.ms);
    else if ('wait' in s) ctx.advance(s.wait);
    else if ('tapBoth' in s) ctx.tapBoth();
    else if ('arm' in s) arm(ctx);
    else if ('take' in s) take(ctx);
    else if ('shoot' in s) { arm(ctx); take(ctx); }
    else if ('callout' in s) callout(ctx, s.callout, s.via);
    else if ('nameStation' in s) nameStation(ctx);
    else if ('cycleMark' in s) cycleMark(ctx, s.cycleMark);
    else if ('repeat' in s) for (let i = 0; i < s.repeat; i++) exec(ctx, s.steps(i));
    else throw new Error(`Unknown step ${JSON.stringify(s)}`);
  }
}

export function runScenario(scenario, profile, { content } = {}) {
  if (profile !== STOCK && profile !== PROPOSED) throw new Error(`Unknown profile: ${profile}`);
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
  return (t.taps + t.chords) * m.tapMs + t.longs * m.longExtraMs + t.holdMs + r.shots * m.shotMs;
}

export function toMarkdown(comparisons, model = DEFAULT_TIME_MODEL) {
  const lines = [
    '| Scenario | Profile | Presses | Taps | Long | Chords | Hold | Est. time | Marks | Names | Callouts |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of comparisons) {
    for (const r of [c.stock, c.proposed]) {
      const t = r.totals;
      lines.push(`| ${c.scenario.name} | ${r.profile} | ${t.presses} | ${t.taps} | ${t.longs} | ${t.chords} | ${(t.holdMs / 1000).toFixed(1)} s | ${(estimateMs(r, model) / 1000).toFixed(0)} s | ${r.marks} | ${r.names} | ${r.tags} |`);
    }
  }
  lines.push('', `Est. time model: ${model.tapMs} ms per tap, each long press its hold plus ${model.longExtraMs} ms, each chord like a tap, ${model.shotMs} ms per shot. Counts are exact; times are a rough guide.`);
  return lines.join('\n');
}

// ---- built-in scenarios --------------------------------------------------------
const STATIONS = 10;
const stationPose = (i) => ({ az: (20 + i * 31) % 360, inc: (i % 5) * 3 - 6, dist: 3 + (i % 4) });
const FEATURES = ['Drip', 'Squeeze', 'Lead'];
const CALLOUT_CYCLE = ['Drip', 'Straw', 'Crawl', 'Lead'];

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
    id: 'tag-features-b',
    name: 'Tag 10 features (B button)',
    description: 'Like Tag 10 features, but proposed opens the picker with the B button (both arrows) instead of holding M.',
    variants: {
      stock: () => [{
        repeat: 10,
        steps: (i) => [{ task: `Feature ${i + 1}` }, { pose: stationPose(i) }, { arm: true }, { cycleMark: 'Feature' }, { take: true }],
      }],
      proposed: () => [{
        repeat: 10,
        steps: (i) => [{ task: `Feature ${i + 1}` }, { pose: stationPose(i) }, { arm: true }, { callout: FEATURES[i % FEATURES.length], via: 'both' }, { take: true }],
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
