// Panel pieces for judging the proposed interface: profile switch, press counter,
// scenario comparison and the callout editor.
import { STOCK, PROPOSED } from '../device/ui/profile.js';
import { InputRecorder, presses } from '../device/ui/recorder.js';
import { parseCallouts, DEFAULT_CALLOUT_TEXT, calloutLabel, findCallout } from '../device/ui/callouts.js';
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
  sel.value = saved.profile === PROPOSED ? PROPOSED : STOCK;
  ui.setProfile(sel.value);
  sel.addEventListener('change', () => {
    ui.setProfile(sel.value);
    rec.reset();
    store.set({ profile: sel.value });
    sel.blur(); // so the X1's keys work again
    note(`Profile: ${sel.value}. The X1 was powered off and callouts and names were cleared.`);
  });

  // ---- callout content -----------------------------------------------------
  const content = saved.content ?? { text: DEFAULT_CALLOUT_TEXT, prefix: 'S', first: 1 };
  // Content saved by an older two-level menu no longer parses: fall back to the default list.
  if (!parseCallouts(content.text).ok) content.text = DEFAULT_CALLOUT_TEXT;
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
    // Callouts are stored as positions: follow names to their new place, drop removed ones.
    const old = ui.content.callouts;
    ui.annotations.remapTags((code) => {
      const label = calloutLabel(old, code);
      return label ? findCallout(r.items, label) : 0;
    });
    ui.content = { callouts: r.items, namePrefix: prefix, nameFirst: first };
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
    const first = rec.startedAt ?? 0;
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
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      note(done);
    } catch (e) {
      note(`Could not copy: ${e.message}`);
    }
  };
  $('btnCountCopy').addEventListener('click', () => copy(rec.toText(), 'Press counts copied'));

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
    for (const h of ['Profile', 'Presses', 'Taps', 'Long', 'Hold', 'Est.', 'Marks', 'Names', 'Callouts']) head.append(el('th', h));
    t.append(head);
    for (const r of [c.stock, c.proposed]) {
      const x = r.totals;
      const row = el('tr');
      for (const v of [r.profile, x.presses, x.taps, x.longs, `${(x.holdMs / 1000).toFixed(1)} s`, `${(estimateMs(r) / 1000).toFixed(0)} s`, r.marks, r.names, r.tags]) row.append(el('td', String(v)));
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
    const done = [];
    const blocks = [];
    for (const s of list) {
      try {
        const c = compare(s, { content: ui.content });
        blocks.push(table(c));
        done.push(c);
      } catch (e) {
        blocks.push(el('p', `${s.name} failed: ${e.message}`, 'errors'));
      }
    }
    last = done;
    $('scenarioOut').replaceChildren(...blocks);
  }
  $('btnRun').addEventListener('click', () => run([SCENARIOS.find((s) => s.id === sc.value)]));
  $('btnRunAll').addEventListener('click', () => run(SCENARIOS));
  $('btnScenarioCopy').addEventListener('click', async () => {
    if (!last.length) { note('Run a scenario first'); return; }
    await copy(toMarkdown(last), 'Scenario results copied as markdown');
  });
}
