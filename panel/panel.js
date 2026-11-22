// Side panel: owns the emulated X1 while open. Closing the panel unplugs it.
import { X1, defaultFaults, defaultSettings } from '../device/x1.js';
import { makeRng } from '../device/rng.js';
import { Host } from './host.js';
import { attachHost } from './glue.js';
import { Ui } from '../device/ui/ui.js';
import { mountFace } from './face.js';

const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;
const ONE_SHOTS = ['dropNextReply', 'strayNext'];

const saved = await store.get(['device', 'faults', 'settings', 'plugged', 'enabled']);
const faults = { ...defaultFaults(), ...saved.faults };
for (const k of ONE_SHOTS) faults[k] = false;
const settings = { ...defaultSettings(), ...saved.settings };
const x1 = makeX1(saved.device);

function makeX1(json) {
  try {
    if (json) return X1.fromJSON(json, { faults, settings, rng: makeRng(faults.seed) });
  } catch (e) {
    console.warn('Stored device state unreadable, starting fresh', e);
  }
  return new X1({ faults, settings, rng: makeRng(faults.seed) });
}

// ---- traffic log -----------------------------------------------------------
const logEl = $('log');
const MAX_LINES = 2000;
const hex = (b) => Array.from(b.slice(0, 48), (x) => x.toString(16).padStart(2, '0')).join(' ') + (b.length > 48 ? ` … +${b.length - 48}` : '');
const stamp = () => new Date().toISOString().slice(11, 23);
function logLine(cls, text) {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  while (logEl.childElementCount > MAX_LINES) logEl.firstChild.remove();
  if ($('chkFollow').checked) logEl.scrollTop = logEl.scrollHeight;
}
const note = (text) => logLine('note', `${stamp()} ·· ${text}`);

// ---- LEDs --------------------------------------------------------------------
const led = (name, on) => document.querySelector(`[data-led="${name}"]`).classList.toggle('on', !!on);
const blinkTimers = {};
function blink(name) {
  led(name, true);
  clearTimeout(blinkTimers[name]);
  blinkTimers[name] = setTimeout(() => led(name, false), 70);
}

// ---- host ----------------------------------------------------------------------
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const f = { ...x1.faults };
    for (const k of ONE_SHOTS) delete f[k];
    store.set({ device: x1.toJSON(), faults: f, settings: x1.settings, plugged: host.plugged });
  }, 300);
}

const host = new Host({
  x1,
  onTraffic: (dir, bytes) => {
    blink(dir === 'in' ? 'rx' : 'tx');
    logLine(dir, `${stamp()} ${dir === 'in' ? 'RX' : 'TX'} ${hex(bytes)}`);
  },
  onChange: () => { render(); save(); },
  onLog: note,
});
x1.on((type) => { if (type === 'change') { render(); save(); } });

await attachHost(host, chrome);
if (saved.plugged) host.setPlugged(true);

// ---- front face ------------------------------------------------------------------
const ui = new Ui({ x1 });
ui.instrument.onLive = (packet) => host.sendUnsolicited(packet);
mountFace({ ui, canvas: $('lcd'), root: $('face'), note });

// ---- rendering -----------------------------------------------------------------
function fmtClock(t) {
  return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function render() {
  const s = x1.state();
  const plugged = host.plugged;
  const btn = $('btnPlug');
  btn.textContent = plugged ? 'Disconnect' : 'Connect';
  btn.setAttribute('aria-pressed', String(plugged));
  const sess = host.session;
  $('status').textContent = s.resetHeld ? 'Held in reset' : s.booting ? 'Booting…' : !plugged ? 'Unplugged'
    : sess ? `Open by ${new URL(sess.origin).host} at ${sess.options.baudRate} baud${sess.wire.lineOk ? '' : ' — line settings wrong, bytes garbled'}`
      : 'Plugged in, port closed';
  $('serialNo').textContent = String(s.serial).padStart(4, '0');
  led('power', plugged && !s.booting);
  led('laser', s.laser);
  led('cali', s.cali);
  led('brick', s.fw.state === 'bootloader');
  $('shotCount').textContent = s.shots;
  $('btnMeasure').disabled = s.fw.state !== 'app' || s.booting;
  const st = $('fwState');
  st.textContent = { app: 'Running', receiving: 'Receiving firmware', bootloader: 'Bootloader (bricked)' }[s.fw.state];
  st.classList.toggle('bricked', s.fw.state === 'bootloader');
  $('fwPackets').textContent = s.fw.state === 'receiving' ? `${s.fw.received} received` : s.fw.installed ? `${s.fw.installed.packets} installed` : '0';
  $('fwCrc').textContent = s.fw.crcFailures;
  $('fwResult').textContent = s.fw.lastResult ?? '—';
  $('fwInstalled').textContent = s.fw.installed
    ? `${s.fw.installed.size} bytes, CRC sum 0x${s.fw.installed.sum.toString(16).toUpperCase()}`
    : 'factory image';
  $('btnSaveImage').disabled = !x1.firmware.image;
  $('btnRecover').hidden = s.fw.state !== 'bootloader';
  if (document.activeElement !== $('inSerial')) $('inSerial').value = s.serial;
  $('outClock').textContent = fmtClock(s.clock);
  const f = x1.faults;
  const active = f.latencyMs || f.jitterMs || f.corruptToHost || f.corruptToDevice || f.dropReplyRate || f.freeze ||
    f.fwNakAt !== null || f.fwBadCrcAt !== null || f.fwStallAt !== null || f.fwUnplugAt !== null || f.fwSlowStartMs || f.fwRejectEnd ||
    f.dropNextReply || f.strayNext;
  $('faultBadge').hidden = !active;
  for (const b of document.querySelectorAll('[data-oneshot]')) b.setAttribute('aria-pressed', String(!!f[b.dataset.oneshot]));
}

// ---- controls --------------------------------------------------------------------
$('btnPlug').addEventListener('click', () => host.setPlugged(!host.plugged));
$('btnReset').addEventListener('click', () => host.reset());

let kind = 'leg';
for (const b of document.querySelectorAll('[data-kind]')) {
  b.addEventListener('click', () => {
    kind = b.dataset.kind;
    for (const o of document.querySelectorAll('[data-kind]')) o.setAttribute('aria-pressed', String(o === b));
  });
}
const num = (id) => ($(id).value === '' ? null : Number($(id).value));
$('btnMeasure').addEventListener('click', () => {
  const live = x1.measure({ splay: kind === 'splay', flag: Number($('selFlag').value), distance: num('inDist'), azimuth: num('inAz'), inclination: num('inInc') });
  if (live) host.sendUnsolicited(live);
});
$('btnClearShots').addEventListener('click', () => {
  x1.memory.shots = [];
  note('Shots cleared');
  render();
  save();
});

$('btnSaveImage').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([x1.firmware.image], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'x1-received-image.bin' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('btnRecover').addEventListener('click', () => { x1.firmware.recover(); note('Recovered to factory firmware'); render(); save(); });

// Faults: inputs write straight into x1.faults.
function readFault(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.value === '') return el.hasAttribute('data-nullable') ? null : 0;
  const v = Number(el.value);
  return el.hasAttribute('data-pct') ? v / 100 : v;
}
function showFault(el) {
  const v = x1.faults[el.dataset.fault];
  if (el.type === 'checkbox') el.checked = !!v;
  else if (v === null) el.value = '';
  else el.value = el.hasAttribute('data-pct') ? +(v * 100).toFixed(3) : v;
}
for (const el of document.querySelectorAll('[data-fault]')) {
  showFault(el);
  el.addEventListener('change', () => {
    x1.faults[el.dataset.fault] = readFault(el);
    if (el.dataset.fault === 'seed') x1.rng.reseed(x1.faults.seed);
    note(`Fault ${el.dataset.fault} = ${JSON.stringify(x1.faults[el.dataset.fault])}`);
    render();
    save();
  });
}
for (const b of document.querySelectorAll('[data-oneshot]')) {
  b.addEventListener('click', () => {
    const k = b.dataset.oneshot;
    x1.faults[k] = !x1.faults[k];
    note(`${x1.faults[k] ? 'Armed' : 'Disarmed'} ${k}`);
    render();
  });
}
$('btnUnplugLater').addEventListener('click', () => {
  const ms = Number($('inUnplugMs').value) || 0;
  note(`Unplugging in ${ms} ms`);
  host.unplugAfter(ms);
});
$('btnClearFaults').addEventListener('click', () => {
  const seed = x1.faults.seed;
  Object.assign(x1.faults, defaultFaults(), { seed });
  for (const el of document.querySelectorAll('[data-fault]')) showFault(el);
  note('Faults cleared');
  render();
  save();
});

// Device drawer.
$('inSerial').addEventListener('change', () => {
  const n = Math.max(0, Math.min(65535, Math.round(Number($('inSerial').value) || 0)));
  x1.memory.setSerial(n);
  note(`Serial number set to ${n}`);
  render();
  save();
});
for (const el of document.querySelectorAll('[data-setting]')) {
  el.checked = !!x1.settings[el.dataset.setting];
  el.addEventListener('change', () => { x1.settings[el.dataset.setting] = el.checked; save(); });
}
let resetArmed = null;
$('btnFactory').addEventListener('click', () => {
  if (!resetArmed) {
    $('btnFactory').textContent = 'Click again to wipe shots, calibration and firmware';
    resetArmed = setTimeout(() => { resetArmed = null; $('btnFactory').textContent = 'Factory reset'; }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  $('btnFactory').textContent = 'Factory reset';
  x1.factoryReset();
  note('Factory reset');
});

// Traffic.
$('btnClearLog').addEventListener('click', () => { logEl.textContent = ''; });
$('btnCopyLog').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logEl.innerText);
  note('Log copied');
});

// Intercept switch lives in storage so every relay sees it.
$('chkIntercept').checked = saved.enabled !== false;
$('chkIntercept').addEventListener('change', () => store.set({ enabled: $('chkIntercept').checked }));

setInterval(() => { x1.tick(); $('outClock').textContent = fmtClock(x1.memory.clock()); }, 1000);
render();
note('Panel ready');
