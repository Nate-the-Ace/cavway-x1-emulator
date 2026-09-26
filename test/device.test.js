import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16modbus } from '../device/crc.js';
import { Deframer } from '../device/framing.js';
import { encodeShot, Flag } from '../device/shots.js';
import { Memory, ADDR } from '../device/memory.js';
import { X1, TIMING } from '../device/x1.js';
import { frame, decodeShot } from './helpers.js';

const bytes = (s) => new TextEncoder().encode(s);

test('crc16 modbus check value', () => {
  assert.equal(crc16modbus(bytes('123456789')), 0x4b37);
});

test('deframer: junk, split frames, bad terminator', () => {
  const d = new Deframer();
  const f = frame([0x3d, 0x08, 0x80, 0x04]);
  assert.deepEqual(d.push(Uint8Array.of(0x00, 0x13, ...f.slice(0, 7))), []);
  assert.deepEqual(d.push(f.slice(7)).map((p) => [...p]), [[0x3d, 0x08, 0x80, 0x04]]);
  assert.equal(d.junkBytes, 2);
  const bad = frame([0x36]);
  bad[bad.length - 1] = 0x00;
  assert.deepEqual(d.push(Uint8Array.of(...bad, ...frame([0x37]))).map((p) => [...p]), [[0x37]]);
  assert.equal(d.badFrames, 1);
});

test('shot record decodes per Shot.cs', () => {
  const s = decodeShot(encodeShot({ time: 1_700_000_123, distance: 12.345, azimuth: 271.5, inclination: -33.25, splay: true, flag: Flag.backsight, absG: 1.002, absM: 47.9, dip: 61.2 }));
  assert.equal(s.isLeg, false);
  assert.equal(s.isCali, false);
  assert.equal(s.flags, 2);
  assert.equal(s.distance, 12.345);
  assert.ok(Math.abs(s.azimuth - 271.5) < 0.01);
  assert.ok(Math.abs(s.inclination + 33.25) < 0.01);
  assert.ok(Math.abs(s.absG - 1.002) < 0.001);
  assert.ok(Math.abs(s.absM - 47.9) < 0.01);
  assert.ok(Math.abs(s.dip - 61.2) < 0.01);
  assert.equal(s.time, 1_700_000_123);
  assert.equal(s.err0, 0xff);
  assert.equal(decodeShot(encodeShot({ time: 0, distance: 1, azimuth: 0, inclination: 0, cali: true })).isCali, true);
});

test('memory: shots by index, clock ticks and can be set, serial', () => {
  let t = 1_700_000_000_000;
  const m = new Memory({ now: () => t, serial: 4321 });
  m.addShot(encodeShot({ time: 5, distance: 2, azimuth: 10, inclination: 0 }));
  assert.equal(m.read(0, 64)[0], 0x00);
  assert.equal(m.read(1, 64)[0], 0xff);
  const s = m.read(ADDR.serial, 4);
  assert.equal(s[0] | (s[1] << 8), 4321);
  m.write(ADDR.clock, Uint8Array.of(0x10, 0x20, 0x30, 0x40));
  t += 3000;
  const c = m.read(ADDR.clock, 4);
  assert.equal((c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)) >>> 0, 0x40302010 + 3);
  m.write(0, Uint8Array.of(1, 2, 3));
  assert.equal(m.read(0, 1)[0], 0x00, 'shot area is read-only');
  const info = m.read(ADDR.caliInfo, 16);
  assert.equal(info[0], 0x55);
  const round = Memory.fromJSON(JSON.parse(JSON.stringify(m)), { now: () => t });
  assert.deepEqual(round.read(0, 64), m.read(0, 64));
  assert.deepEqual(round.read(ADDR.coeffs, 128), m.read(ADDR.coeffs, 128));
});

test('x1: memory read and write replies', () => {
  const x = new X1();
  const [r] = x.receive(frame([0x3d, 0x08, 0x80, 0x04]));
  assert.equal(r.delayMs, TIMING.mem);
  assert.deepEqual([...r.bytes.slice(0, 4)], [0x3d, 0x08, 0x80, 0x04]);
  const [w] = x.receive(frame([0x3e, 0x40, 0x90, 2, 0xaa, 0xbb]));
  assert.deepEqual([...w.bytes], [0x3d, 0x40, 0x90, 2, 0xaa, 0xbb]);
});

test('x1: laser commands, trigger stores a shot and streams it', () => {
  const x = new X1();
  x.hostOpened();
  assert.deepEqual(x.receive(frame([0x36])), []);
  assert.equal(x.state().laser, true);
  const [live] = x.receive(frame([0x38]));
  assert.equal(live.bytes[0], 0x01);
  assert.deepEqual([...live.bytes.slice(-2)], [0x0d, 0x0a]);
  assert.equal(x.state().shots, 1);
  assert.equal(x.state().laser, false);
  x.receive(frame([0x30]));
  const cali = x.measure();
  assert.equal(cali[0], 0x02);
});

function fwPackets(n, fill = 0x11) {
  return Array.from({ length: n }, (_, i) => new Uint8Array(128).fill((fill + i) & 0xff));
}
function fwFrame(i, data, crc = crc16modbus(data)) {
  const p = new Uint8Array(133);
  p.set([0x4c, i & 0xff, i >> 8]);
  p.set(data, 3);
  p.set([crc & 0xff, crc >> 8], 131);
  return frame(p);
}
const endFrame = (sum) => frame([0x4d, sum & 0xff, (sum >>> 8) & 0xff, (sum >>> 16) & 0xff, sum >>> 24]);

test('firmware: full flash installs the image', () => {
  const x = new X1();
  const pk = fwPackets(3);
  assert.deepEqual([...x.receive(frame([0x4b]))[0].bytes], [0x4b, 0x01]);
  let sum = 0;
  pk.forEach((d, i) => {
    const [r] = x.receive(fwFrame(i, d));
    const crc = crc16modbus(d);
    sum += crc;
    assert.deepEqual([...r.bytes], [0x4c, i, 0, 0x00, crc & 0xff, crc >> 8]);
  });
  assert.equal(x.receive(frame([0x3d, 0, 0, 4])).length, 0, 'busy while flashing');
  assert.deepEqual([...x.receive(endFrame(sum))[0].bytes], [0x4d, 0x00]);
  assert.equal(x.state().fw.state, 'app');
  assert.equal(x.state().fw.installed.packets, 3);
  assert.equal(x.firmware.image.length, 384);
});

test('firmware: bad crc and out-of-order packets are refused', () => {
  const x = new X1();
  x.receive(frame([0x4b]));
  const d = fwPackets(1)[0];
  assert.equal(x.receive(fwFrame(0, d, 0x1234))[0].bytes[3], 0x01);
  assert.equal(x.receive(fwFrame(1, d))[0].bytes[3], 0x01);
  assert.equal(x.state().fw.crcFailures, 2);
});

test('firmware faults: nak, bad crc echo, stall, reject end, unplug', () => {
  const pk = fwPackets(2);
  const x = new X1({ faults: { fwNakAt: 1, fwBadCrcAt: 0 } });
  x.receive(frame([0x4b]));
  const r0 = x.receive(fwFrame(0, pk[0]))[0].bytes;
  assert.equal(r0[3], 0x00);
  assert.notEqual(r0[4] | (r0[5] << 8), crc16modbus(pk[0]));
  assert.equal(x.receive(fwFrame(1, pk[1]))[0].bytes[3], 0x01);

  const y = new X1({ faults: { fwStallAt: 0 } });
  y.receive(frame([0x4b]));
  assert.equal(y.receive(fwFrame(0, pk[0])).length, 0);

  const z = new X1({ faults: { fwRejectEnd: true } });
  z.receive(frame([0x4b]));
  z.receive(fwFrame(0, pk[0]));
  assert.deepEqual([...z.receive(endFrame(crc16modbus(pk[0])))[0].bytes], [0x4d, 0x01]);
  assert.equal(z.state().fw.state, 'bootloader');

  const u = new X1({ faults: { fwUnplugAt: 0 } });
  let unplugged = false;
  u.on((type) => { if (type === 'unplug') unplugged = true; });
  u.receive(frame([0x4b]));
  u.receive(fwFrame(0, pk[0]));
  assert.ok(unplugged);
});

test('interrupted flash bricks the device until a good flash', () => {
  const x = new X1();
  const pk = fwPackets(1);
  x.hostOpened();
  x.receive(frame([0x4b]));
  x.hostClosed();
  assert.equal(x.state().fw.state, 'bootloader');
  assert.equal(x.receive(frame([0x3d, 0x08, 0x80, 4])).length, 0);
  assert.equal(x.measure(), null);
  x.receive(frame([0x4b]));
  x.receive(fwFrame(0, pk[0]));
  x.receive(endFrame(crc16modbus(pk[0])));
  assert.equal(x.state().fw.state, 'app');

  const soft = new X1({ settings: { brickOnAbort: false } });
  soft.receive(frame([0x4b]));
  soft.hostClosed();
  assert.equal(soft.state().fw.state, 'app');
});

test('quiet host during flash aborts after the idle limit', () => {
  let t = 0;
  const x = new X1({ now: () => t });
  x.receive(frame([0x4b]));
  t += 10_001;
  x.tick();
  assert.equal(x.state().fw.state, 'bootloader');
});

test('reply faults: freeze, drop next, stray packet', () => {
  const x = new X1({ faults: { freeze: true } });
  assert.equal(x.receive(frame([0x3d, 0, 0x80, 4])).length, 0);
  const y = new X1({ faults: { dropNextReply: true } });
  assert.equal(y.receive(frame([0x3d, 0, 0x80, 4])).length, 0);
  assert.equal(y.receive(frame([0x3d, 0, 0x80, 4])).length, 1);
  const z = new X1({ faults: { strayNext: true } });
  const out = z.receive(frame([0x3d, 0, 0x80, 4]));
  assert.equal(out.length, 2);
  assert.equal(out[0].bytes[0], 0x01);
  assert.equal(out[1].bytes[0], 0x3d);
});

test('x1 state round-trips through JSON', () => {
  const x = new X1();
  x.measure();
  x.measure({ splay: true });
  const y = X1.fromJSON(JSON.parse(JSON.stringify(x)));
  assert.equal(y.state().shots, 2);
  assert.equal(y.state().serial, x.state().serial);
});

test('reboot: modes clear, memory kept, silent while booting, flash interrupted', () => {
  let t = 1_700_000_000_000;
  const x = new X1({ now: () => t });
  x.measure();
  x.receive(frame([0x36]));
  x.receive(frame([0x30]));
  x.reboot();
  assert.equal(x.state().laser, false);
  assert.equal(x.state().cali, false);
  assert.equal(x.state().shots, 1);
  assert.equal(x.receive(frame([0x3d, 0x08, 0x80, 4])).length, 0, 'booting');
  assert.equal(x.measure(), null);
  t += 700;
  assert.equal(x.receive(frame([0x3d, 0x08, 0x80, 4])).length, 1);
  x.receive(frame([0x4b]));
  x.reboot();
  assert.equal(x.state().fw.state, 'bootloader');
});

test('reset held: silent until released, then boots', () => {
  let t = 0;
  const x = new X1({ now: () => t });
  x.holdReset(true);
  t += 5000;
  assert.equal(x.receive(frame([0x3d, 0x08, 0x80, 4])).length, 0);
  x.holdReset(false);
  assert.equal(x.state().booting, true);
  t += 700;
  assert.equal(x.receive(frame([0x3d, 0x08, 0x80, 4])).length, 1);
});
