// The flasher's own transport and protocol code, unmodified, against the shim,
// relay, host and emulated X1. Skipped when ../cavway-assistant-web is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeChrome, makePage } from './fakes.js';
import { Host } from '../panel/host.js';
import { attachHost } from '../panel/glue.js';
import { X1 } from '../device/x1.js';

const FLASHER = new URL('../../cavway-assistant-web/src/', import.meta.url);
const skip = !existsSync(new URL('protocol.js', FLASHER)) && 'flasher repo not checked out beside this one';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rig(faults = {}, settings = {}) {
  const { WebSerialTransport } = await import(new URL('transport.js', FLASHER));
  const { Device } = await import(new URL('protocol.js', FLASHER));
  const chrome = makeChrome();
  const x1 = new X1({ faults, settings });
  const host = new Host({ x1 });
  const page = makePage(chrome);
  chrome._setPanelOpen(true);
  await attachHost(host, chrome);
  host.setPlugged(true);
  await sleep(20);
  Object.defineProperty(globalThis, 'navigator', { value: page.nav, configurable: true });
  const t = new WebSerialTransport();
  await t.open();
  return { t, dev: new Device(t), x1, host };
}

// A Cavway .bin: 256-byte header (id, build time, version) then the image.
function makeBin(bodyLen) {
  const bin = new Uint8Array(256 + bodyLen).fill(0);
  bin.set([0x11, 0x23, 0x55, 0x6e, 0x7c, 0xef, 0x6d, 0x5b], 0);
  bin.set([0x66, 0x00, 0x00, 0x00, 1, 2, 3], 8);
  for (let i = 256; i < bin.length; i++) bin[i] = (i * 7) & 0xff;
  return bin;
}

test('serial number, clock sync, shot download', { skip }, async () => {
  const { t, dev, x1 } = await rig();
  assert.equal(await dev.readSerial(), x1.memory.serial());
  await dev.syncTime(Date.UTC(2026, 8, 25, 12, 0, 0), 0);
  assert.ok(Math.abs(x1.memory.clock() - Date.UTC(2026, 8, 25, 12, 0, 0) / 1000) <= 1);
  for (let i = 0; i < 4; i++) x1.measure({ splay: i % 2 === 1, distance: 2 + i, azimuth: 10 * i, inclination: -i });
  const shots = await dev.downloadShots(10);
  assert.equal(shots.length, 4);
  assert.equal(shots[2].distance.toFixed(3), '4.000');
  await t.close();
});

test('calibration download and upload round trip', { skip }, async () => {
  const { t, dev, x1 } = await rig();
  const cali = await dev.downloadCali();
  const before = x1.memory.read(0x9080, 128);
  await dev.uploadCali(cali);
  assert.deepEqual(x1.memory.read(0x9080, 128), before);
  await t.close();
});

test('laser commands reach the device', { skip }, async () => {
  const { t, dev, x1 } = await rig();
  await dev.command(0x36);
  await sleep(30);
  assert.equal(x1.laser, true);
  await dev.command(0x37);
  await sleep(30);
  assert.equal(x1.laser, false);
  await t.close();
});

test('firmware flash installs the image', { skip }, async () => {
  const { t, dev, x1 } = await rig();
  const bin = makeBin(128 * 6 + 40);
  const progress = [];
  await dev.upgradeFirmware(bin, (p) => progress.push(p));
  assert.equal(progress.at(-1), 100);
  assert.equal(x1.firmware.installed.packets, 7);
  assert.deepEqual(x1.firmware.image.slice(0, 128 * 6 + 40), bin.slice(256));
  await t.close();
});

test('unplug mid-flash: flasher fails, device bricked, reflash recovers', { skip }, async () => {
  const { t, dev, x1, host } = await rig({ fwUnplugAt: 2 });
  const bin = makeBin(128 * 5);
  await assert.rejects(dev.upgradeFirmware(bin));
  await sleep(20);
  assert.equal(t.isOpen, false, 'flasher saw the disconnect');
  assert.equal(x1.firmware.state, 'bootloader');
  x1.faults.fwUnplugAt = null;
  host.setPlugged(true);
  await sleep(20);
  const again = new (t.constructor)();
  await again.open();
  const { Device } = await import(new URL('protocol.js', FLASHER));
  const d2 = new Device(again);
  assert.equal(await d2.readSerial(), 0, 'bricked: no answer to memory reads');
  await d2.upgradeFirmware(bin);
  assert.equal(x1.firmware.state, 'app');
  assert.equal(await d2.readSerial(), x1.memory.serial());
  await again.close();
});

// 4 × 128 bytes: upstream sends an extra all-0xFF packet, hence "of 5".
test('NAK and bad CRC echo stop the flash at that packet', { skip }, async () => {
  const bin = makeBin(128 * 4);
  let r = await rig({ fwNakAt: 1 });
  await assert.rejects(r.dev.upgradeFirmware(bin), /packet 1 of 5/);
  await r.t.close();
  r = await rig({ fwBadCrcAt: 2 });
  await assert.rejects(r.dev.upgradeFirmware(bin), /packet 2 of 5/);
  await r.t.close();
});

test('slow erase past the 3 s start timeout fails the flash', { skip }, async () => {
  const { t, dev } = await rig({ fwSlowStartMs: 3000 });
  await assert.rejects(dev.upgradeFirmware(makeBin(128)), /refused to start/);
  await t.close();
});

test('stray unsolicited packet before a reply is skipped by the flasher', { skip }, async () => {
  const { t, dev, x1 } = await rig({ strayNext: true });
  x1.measure();
  assert.equal(await dev.readSerial(), x1.memory.serial());
  await t.close();
});

test('dropped reply times out, next one works', { skip }, async () => {
  const { t, dev, x1 } = await rig({ dropNextReply: true });
  await assert.rejects(dev.readMemory(0x8008, 4), { name: 'TimeoutError' });
  assert.equal(await dev.readSerial(), x1.memory.serial());
  await t.close();
});

