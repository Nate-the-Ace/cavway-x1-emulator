import { scene, lr } from '../scene.js';
import { fmtDate, fmtTime } from '../format.js';
import { defaultUiSettings } from '../settings.js';
import { ADDR } from '../../memory.js';
import { CalibrationScreen } from './calibration.js';

const FOOT = ['< >:Prev/Next', 'M:Enter'];
const FOOT_ADJ = ['< >:Prev/Next', 'M:Adjust CLR:Back'];
const ONOFF = (v) => (v ? 'ON' : 'OFF');
const nextOf = (values, cur) => values[(values.indexOf(cur) + 1) % values.length];

// A cycling setting: M steps to the next value.
const cyc = (label, key, values, fmt = String) => ({
  label,
  value: (ui) => fmt(ui.settings[key]),
  adjust: (ui) => { ui.settings[key] = nextOf(values, ui.settings[key]); },
});

// A list of items with a '>' cursor. Item: { label, value?(ui), adjust?(ui), enter?(ui, self), run?(ui, self) }.
export class ListScreen {
  constructor({ items, back, footer = FOOT }) {
    this.items = items;
    this.back = back;
    this.footer = footer;
    this.cursor = 0;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const last = this.items.length - 1;
    if (b === 'left') this.cursor = Math.max(0, this.cursor - 1);
    else if (b === 'right') this.cursor = Math.min(last, this.cursor + 1);
    else if (b === 'm') {
      const it = this.items[this.cursor];
      if (it.adjust) it.adjust(ui);
      else if (it.enter) ui.go(it.enter(ui, this));
      else if (it.run) it.run(ui, this);
    } else if (b === 'clr') this.back(ui);
  }

  render(ui) {
    const start = Math.max(0, this.cursor - 4);
    const rows = [];
    for (let i = start; i < Math.min(this.items.length, start + 5); i++) {
      const it = this.items[i];
      const left = `${i === this.cursor ? '> ' : '  '}${it.label}`;
      rows.push(it.value ? lr(left, it.value(ui)) : left);
    }
    while (rows.length < 6) rows.push('');
    return scene([...rows, ...this.footer]);
  }
}

export class ConfirmScreen {
  constructor(lines, onYes, onNo) {
    this.lines = lines;
    this.onYes = onYes;
    this.onNo = onNo;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm') this.onYes(ui);
    else if (b === 'clr') this.onNo(ui);
  }

  render() {
    const rows = [...this.lines];
    while (rows.length < 6) rows.push('');
    return scene([...rows, 'M:Confirm', 'CLR:Cancel']);
  }
}

export const clearUnsentConfirm = (onDone) =>
  new ConfirmScreen(['', 'Clear unsent', ' Shots?'], (ui) => { ui.clearUnsent(); onDone(ui); }, onDone);

export function optionsMenu(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Ref.', 'ref', ['Rear', 'Tail', 'Tripod', 'Front', 'Custom']),
      cyc('Shot delay:', 'shotDelay', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (v) => `${v}s`),
      cyc('Backlight:', 'backlight', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      cyc('Beep:', 'beep', [true, false], ONOFF),
      cyc('IdleOff:', 'idleOff', [60, 120, 180, 240, 300], (v) => `${v}s`),
    ],
  });
}

const SHOT_DEFAULTS = ['errDetect', 'angleDiff', 'absLim', 'dipLim'];

function shotOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Err Detect:', 'errDetect', [true, false], ONOFF),
      cyc('Angle Diff:', 'angleDiff', [0.2, 0.3, 0.4, 0.5, 0.6, 1.0], (v) => `${v.toFixed(1)}°`),
      cyc('ABS Lim:', 'absLim', [0.5, 0.8, 1.0, 1.5, 2.0, 3.0], (v) => `${v.toFixed(1)}%`),
      cyc('dip Lim:', 'dipLim', [0.5, 0.8, 1.0, 1.5, 2.0, 3.0], (v) => `${v.toFixed(1)}°`),
      { label: 'Reset Default', run: (ui) => { const d = defaultUiSettings(); for (const k of SHOT_DEFAULTS) ui.settings[k] = d[k]; ui.beep('short'); } },
      { label: 'Reset Statistic', run: (ui) => ui.beep('short') },
    ],
  });
}

function scanOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Enable:', 'scanEnable', [true, false], ONOFF),
      cyc('Speed:', 'scanSpeed', ['Low', 'Med.', 'High']),
      cyc('Trigger:', 'scanTrigger', ['DIST+M', '>']),
      cyc('Scan:', 'scanMinutes', [1, 2, 5, 10], (v) => `${v} Min`),
    ],
  });
}

function calOptions(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [
      cyc('Err Detect:', 'calErrDetect', [true, false], ONOFF),
      cyc('Grp Limit:', 'grpLimit', [1, 3, 4, 5, 6, 8, 10], (v) => `${v}%`),
    ],
  });
}

function unitsMenu(back) {
  return new ListScreen({
    back,
    footer: FOOT_ADJ,
    items: [cyc('Distance:', 'distUnit', ['m', 'ft']), cyc('Angle:', 'angleUnit', ['deg', 'grad'])],
  });
}

function bleMenu(back) {
  return new ListScreen({ back, footer: ['', 'M:Adjust CLR:Back'], items: [cyc('Force Pair:', 'forcePair', [false, true], ONOFF)] });
}

const TIME_LIMITS = [[2000, 2099], [1, 12], [1, 31], [0, 23], [0, 59], [0, 59]];
const TIME_NAMES = ['Year:', 'Month:', 'Day:', 'Hour:', 'Min:', 'Sec:'];

// '<' '>' adjust the value, M moves to the next field, CLR saves.
export class TimeScreen {
  constructor(back) { this.back = back; }

  enter(ui) {
    const d = new Date(ui.x1.memory.clock() * 1000);
    this.f = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
    this.at = 0;
  }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    const [lo, hi] = TIME_LIMITS[this.at];
    if (b === 'right') this.f[this.at] = this.f[this.at] >= hi ? lo : this.f[this.at] + 1;
    else if (b === 'left') this.f[this.at] = this.f[this.at] <= lo ? hi : this.f[this.at] - 1;
    else if (b === 'm') this.at = (this.at + 1) % 6;
    else if (b === 'clr') {
      const [y, mo, d, h, mi, s] = this.f;
      const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      ui.x1.memory.setClock(Date.UTC(y, mo - 1, Math.min(d, daysInMonth), h, mi, s) / 1000);
      this.back(ui);
    }
  }

  render() {
    const rows = this.f.map((v, i) => lr(`${i === this.at ? '> ' : '  '}${TIME_NAMES[i]}`, String(v)));
    return scene([...rows, '< >:Adjust', 'M:Next CLR:Save']);
  }
}

// Two pages: device info, then calibration info read from device memory.
export class InfoScreen {
  constructor(back) { this.back = back; this.page = 0; }

  key(ui, b, kind) {
    if (kind !== 'tap') return;
    if (b === 'm') this.page = (this.page + 1) % 2;
    else if (b === 'clr') this.back(ui);
  }

  render(ui) {
    if (this.page === 0) {
      const fw = ui.profile === 'stock-1.1.7' ? '1.1.7' : '1.1.7+proposed';
      return scene([
        'CAVWAY X1', `Hardware: 1.0`, `Firmware: ${fw}`, 'Ble ver.:0.4.0',
        `Serial:   ${String(ui.x1.memory.serial()).padStart(4, '0')}`, 'Battery: 4.00V', '', 'M:NEXT CLR:Back',
      ]);
    }
    const info = ui.x1.memory.read(ADDR.caliInfo, 16);
    if (info[0] !== 0x55) return scene(['', '', 'NO CALI INFORMATION', '', '', '', '', 'M:NEXT CLR:Back']);
    const t = (info[2] | (info[3] << 8) | (info[4] << 16) | (info[5] << 24)) >>> 0;
    const v = (at) => ((info[at] | (info[at + 1] << 8)) / 100).toFixed(2);
    return scene([
      'Sensor 1', lr('Time:', fmtDate(t)), lr('', fmtTime(t)),
      lr('Aver. Err.:', v(6)), lr('Err stddev:', v(8)), lr('Max Err.:', v(10)), lr('Dip:', v(12)), 'M:NEXT CLR:Back',
    ]);
  }
}

function advancedMenu(back) {
  return new ListScreen({
    back,
    items: [
      { label: 'Shot Options', enter: (ui, self) => shotOptions((u) => u.resume(self)) },
      { label: 'Scan Options', enter: (ui, self) => scanOptions((u) => u.resume(self)) },
      { label: 'Cal. Options', enter: (ui, self) => calOptions((u) => u.resume(self)) },
      { label: 'Time', enter: (ui, self) => new TimeScreen((u) => u.resume(self)) },
      { label: 'Units', enter: (ui, self) => unitsMenu((u) => u.resume(self)) },
      { label: 'BLE options', enter: (ui, self) => bleMenu((u) => u.resume(self)) },
      {
        label: 'Factory reset',
        enter: (ui, self) => new ConfirmScreen(
          ['', 'Factory reset', ' Erase all?'],
          (u) => { u.x1.factoryReset(); Object.assign(u.settings, defaultUiSettings()); u.sent.clear(); u.open('home'); },
          (u) => u.resume(self),
        ),
      },
    ],
  });
}

export function mainMenu() {
  return new ListScreen({
    back: (ui) => ui.open('home'),
    items: [
      { label: 'Calibration', enter: () => new CalibrationScreen() },
      { label: 'Clr. Unsent', enter: (ui, self) => clearUnsentConfirm((u) => u.resume(self)) },
      { label: 'Options', enter: (ui, self) => optionsMenu((u) => u.resume(self)) },
      { label: 'Information', enter: (ui, self) => new InfoScreen((u) => u.resume(self)) },
      { label: 'Advan. Menu', enter: (ui, self) => advancedMenu((u) => u.resume(self)) },
    ],
  });
}
