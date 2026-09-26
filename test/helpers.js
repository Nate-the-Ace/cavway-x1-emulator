// Test helpers: a fake clock with timers, host framing, and an independent
// transcription of Shot.cs's decoder (so encode and decode are not one mind).
export class FakeClock {
  constructor(start = 1_700_000_000_000) {
    this.t = start;
    this.timers = new Map();
    this.nextId = 1;
    this.now = () => this.t;
    this.setTimer = (fn, ms) => { const id = this.nextId++; this.timers.set(id, { fn, at: this.t + ms }); return id; };
    this.clearTimer = (id) => { this.timers.delete(id); };
  }

  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let best = null;
      for (const [id, tm] of this.timers) if (tm.at <= end && (!best || tm.at < best[1].at || (tm.at === best[1].at && id < best[0]))) best = [id, tm];
      if (!best) break;
      this.timers.delete(best[0]);
      this.t = Math.max(this.t, best[1].at);
      best[1].fn();
    }
    this.t = end;
  }
}

// sendPacket in UART.cs.
export function frame(payload) {
  const p = Uint8Array.from(payload);
  const out = new Uint8Array(p.length + 8);
  out.set([0x64, 0x61, 0x74, 0x61, 0x3a, p.length & 0xff]);
  out.set(p, 6);
  out.set([0x0d, 0x0a], p.length + 6);
  return out;
}

// Shot(byte[] store) from Shot.cs.
export function decodeShot(store) {
  if (store[0] === 0xff) return null;
  const f = store[1];
  const i16 = (v) => (v << 16) >> 16;
  return {
    isLeg: (f & 0x80) === 0,
    isCali: (f & 0x01) === 0,
    flags: (f >> 1) & 7,
    distance: ((store[2] << 16) | (store[4] << 8) | store[3]) / 1000,
    azimuth: (((store[6] << 8) | store[5]) * 360) / 65535,
    inclination: (i16((store[8] << 8) | store[7]) * 360) / 65535,
    absG: (((store[11] | (store[12] << 8)) * 667) / 1000) / 16384,
    absM: (((store[13] | (store[14] << 8)) * 4876) / 100) / 16384,
    dip: ((store[15] | (store[16] << 8)) * 360) / 65535,
    time: ((store[20] << 24) | (store[19] << 16) | (store[18] << 8) | store[17]) >>> 0,
    err0: store[45],
  };
}
