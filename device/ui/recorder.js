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
    this.startedAt = null; // time of the first input since reset
    this.tasks = [newTask('Start')];
  }

  // Start counting into a new, named bucket. The first call renames the empty start bucket.
  task(name) {
    const cur = this.tasks.at(-1);
    if (cur.events === 0 && cur.name === 'Start') cur.name = name;
    else this.tasks.push(newTask(name));
  }

  record(e) {
    // The hold beyond a long press's threshold, reported when the button is released.
    if (e.kind === 'release') { this.tasks.at(-1).holdMs += e.heldMs; return; }
    if (this.startedAt === null) this.startedAt = e.t;
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
    const shown = this.events.slice(Math.max(0, this.events.length - logLines));
    out.push('', `Last ${shown.length} inputs:`);
    for (const e of shown) {
      out.push(`+${((e.t - this.startedAt) / 1000).toFixed(1)}s ${e.kind} ${e.button} ${e.screen}`);
    }
    return out.join('\n');
  }
}
