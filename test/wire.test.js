import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wire, BYTE_MS } from '../device/wire.js';
import { X1, TIMING } from '../device/x1.js';
import { FakeClock, frame } from './helpers.js';

function rig(faults = {}) {
  const clock = new FakeClock();
  const x1 = new X1({ now: clock.now, faults });
  const chunks = [];
  const wire = new Wire({ x1, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, deliver: (b) => chunks.push({ t: clock.t, b }) });
  wire.open({ baudRate: 115200 });
  return { clock, x1, wire, chunks };
}

test('reply arrives after line time + processing, in 1 ms USB chunks', () => {
  const { clock, wire, chunks } = rig();
  const req = frame([0x3d, 0x00, 0x00, 64]); // 12 bytes out, 68 back
  const t0 = clock.t;
  wire.hostWrite(req);
  clock.advance(100);
  const all = chunks.flatMap((c) => [...c.b]);
  assert.equal(all.length, 68);
  assert.equal(all[0], 0x3d);
  const expectFirst = 12 * BYTE_MS + TIMING.mem + BYTE_MS;
  assert.ok(chunks[0].t - t0 >= expectFirst - 1 && chunks[0].t - t0 <= expectFirst + 1, `first chunk at ${chunks[0].t - t0}`);
  const expectLast = 12 * BYTE_MS + TIMING.mem + 68 * BYTE_MS;
  assert.ok(Math.abs(chunks.at(-1).t - t0 - expectLast) <= 1);
  assert.ok(chunks.length >= 5, 'split over several frames');
  for (const c of chunks) assert.ok(c.b.length <= 64);
});

test('latency fault delays the reply', () => {
  const { clock, wire, chunks } = rig({ latencyMs: 250 });
  wire.hostWrite(frame([0x3d, 0x08, 0x80, 4]));
  clock.advance(200);
  assert.equal(chunks.length, 0);
  clock.advance(100);
  assert.ok(chunks.length > 0);
});

test('wrong baud rate garbles the line', () => {
  const clock = new FakeClock();
  const x1 = new X1({ now: clock.now });
  const chunks = [];
  const wire = new Wire({ x1, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, deliver: (b) => chunks.push(b) });
  wire.open({ baudRate: 9600 });
  wire.hostWrite(frame([0x3d, 0x08, 0x80, 4]));
  clock.advance(100);
  assert.equal(chunks.length, 0, 'device never saw a valid frame');
  assert.ok(x1.state().junkBytes > 0);
});

test('corruption to host flips bits', () => {
  const { clock, wire, chunks } = rig({ corruptToHost: 1 });
  wire.hostWrite(frame([0x3d, 0x08, 0x80, 4]));
  clock.advance(100);
  const got = chunks.flatMap((c) => [...c.b]);
  assert.equal(got.length, 8);
  assert.notEqual(got[0], 0x3d);
});

test('close cancels pending replies and tells the device', () => {
  const { clock, x1, wire, chunks } = rig();
  wire.hostWrite(frame([0x4b]));
  wire.close();
  clock.advance(1000);
  assert.equal(chunks.length, 0);
  assert.equal(x1.state().hostOpen, false);
});
