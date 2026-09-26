import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChrome, makePage } from './fakes.js';
import { Host } from '../panel/host.js';
import { attachHost } from '../panel/glue.js';
import { X1 } from '../device/x1.js';
import { frame } from './helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILTER = { filters: [{ usbVendorId: 0x1a86, usbProductId: 0x55d3 }] };

async function rig({ panelOpen = true, plugged = true, faults = {} } = {}) {
  const chrome = makeChrome();
  const x1 = new X1({ faults });
  const host = new Host({ x1 });
  const page = makePage(chrome);
  if (panelOpen) {
    chrome._setPanelOpen(true);
    await attachHost(host, chrome);
    host.setPlugged(plugged);
  }
  await sleep(20);
  return { chrome, x1, host, page, serial: page.nav.serial };
}

async function readUntil(reader, n, ms = 1000) {
  const out = [];
  const deadline = Date.now() + ms;
  while (out.length < n) {
    const r = await Promise.race([reader.read(), sleep(Math.max(1, deadline - Date.now())).then(() => ({ timeout: true }))]);
    if (r.timeout) throw new Error(`timed out with ${out.length}/${n} bytes`);
    if (r.done) break;
    out.push(...r.value);
  }
  return out;
}

test('requestPort needs a user gesture', async () => {
  const { page, serial } = await rig();
  page.activation.isActive = false;
  await assert.rejects(serial.requestPort(FILTER), { name: 'SecurityError' });
});

test('filter validation matches Chrome', async () => {
  const { serial } = await rig();
  await assert.rejects(serial.requestPort({ filters: [{}] }), TypeError);
  await assert.rejects(serial.requestPort({ filters: [{ usbProductId: 1 }] }), TypeError);
});

test('panel closed: chooser has no X1, cancel is NotFoundError', async () => {
  const { page, serial } = await rig({ panelOpen: false });
  page.chooserAnswer = null;
  await assert.rejects(serial.requestPort(FILTER), { name: 'NotFoundError' });
  assert.equal(page.choices[0].emulated, false);
});

test('filter that does not match hides the X1', async () => {
  const { page, serial } = await rig();
  page.chooserAnswer = null;
  await assert.rejects(serial.requestPort({ filters: [{ usbVendorId: 0x0403 }] }), { name: 'NotFoundError' });
  assert.equal(page.choices[0].emulated, false);
});

test('pick, open, talk, close', async () => {
  const { serial, chrome } = await rig();
  const port = await serial.requestPort(FILTER);
  assert.deepEqual(port.getInfo(), { usbVendorId: 0x1a86, usbProductId: 0x55d3 });
  assert.equal(String(port), '[object SerialPort]');
  await assert.rejects(port.open({}), TypeError);
  await assert.rejects(port.open({ baudRate: 115200, dataBits: 6 }), TypeError);
  await port.open({ baudRate: 115200 });
  await assert.rejects(port.open({ baudRate: 115200 }), { name: 'InvalidStateError' });
  const w = port.writable.getWriter();
  await assert.rejects(w.write('nope'), TypeError);
  w.releaseLock();
  const w2 = port.writable.getWriter();
  await w2.write(frame([0x3d, 0x08, 0x80, 4]));
  w2.releaseLock();
  const reader = port.readable.getReader();
  const got = await readUntil(reader, 8);
  assert.deepEqual(got.slice(0, 4), [0x3d, 0x08, 0x80, 4]);
  await assert.rejects(port.close(), TypeError, 'locked reader');
  await reader.cancel();
  reader.releaseLock();
  assert.ok(port.readable, 'a fresh readable after cancel');
  await port.close();
  assert.equal(port.readable, null);
  await sleep(20);
  assert.equal(chrome._store.grants['https://nate-the-ace.github.io'], true);
  assert.equal((await serial.getPorts()).length, 1);
});

test('unplug mid-read: NetworkError, disconnect event, replug fires connect', async () => {
  const { serial, host } = await rig();
  const port = await serial.requestPort(FILTER);
  await port.open({ baudRate: 115200 });
  const reader = port.readable.getReader();
  const events = [];
  serial.addEventListener('disconnect', (e) => events.push(['disconnect', e.target === port]));
  serial.addEventListener('connect', (e) => events.push(['connect', e.target !== port]));
  const pending = reader.read();
  host.setPlugged(false);
  await assert.rejects(pending, { name: 'NetworkError', message: 'The device has been lost.' });
  await sleep(20);
  assert.equal(port.readable, null);
  assert.equal(port.connected, false);
  await port.close();
  host.setPlugged(true);
  await sleep(20);
  assert.deepEqual(events, [['disconnect', true], ['connect', true]]);
  const [again] = await serial.getPorts();
  assert.notEqual(again, port);
  await again.open({ baudRate: 115200 });
});

test('a second page cannot open the port while it is in use', async () => {
  const { chrome, serial } = await rig();
  const other = makePage(chrome, { origin: 'http://localhost' });
  await sleep(20);
  const a = await serial.requestPort(FILTER);
  await a.open({ baudRate: 115200 });
  const b = await other.nav.serial.requestPort(FILTER);
  await assert.rejects(b.open({ baudRate: 115200 }), { name: 'NetworkError', message: 'Failed to open serial port.' });
});

test('panel opening after the page announces the X1', async () => {
  const chrome = makeChrome();
  const host = new Host({ x1: new X1() });
  const page = makePage(chrome);
  await sleep(20);
  chrome._setPanelOpen(true);
  await attachHost(host, chrome);
  host.setPlugged(true);
  await sleep(30);
  const port = await page.nav.serial.requestPort(FILTER);
  await port.open({ baudRate: 115200 });
});

test('intercept off hands requests to the real Web Serial', async () => {
  const { chrome, page, serial } = await rig();
  await chrome.storage.local.set({ enabled: false });
  await sleep(20);
  page.chooserAnswer = 'emulated';
  await assert.rejects(serial.requestPort(FILTER), { name: 'NotFoundError' }, 'no real serial in tests');
  assert.equal(page.choices.length, 0, 'emulator chooser not shown');
});
