// The X1's address space: shots by index below 0x8000, an 8 KB config area
// from 0x8000 with a live clock at 0x8000 and the serial number at 0x8008.
export const ADDR = { clock: 0x8000, serial: 0x8008, caliInfo: 0x9040, coeffs: 0x9080 };
export const CONFIG_BASE = 0x8000;
export const CONFIG_SIZE = 0x2000;
export const SHOT_CAPACITY = 4000; // a guess until the real X1 is measured

export const FV = 24000;
export const FM = 16384;

// Wall-clock seconds written as if local time were UTC, as the host does.
export const localAsUtc = (nowMs, tzOffsetMin = new Date(nowMs).getTimezoneOffset()) =>
  Math.floor(nowMs / 1000) - tzOffsetMin * 60;

export class Memory {
  constructor({ now = () => Date.now(), serial = 1234 } = {}) {
    this.now = now;
    this.shots = [];
    this.config = new Uint8Array(CONFIG_SIZE).fill(0xff);
    this.clockOffset = localAsUtc(now()) - Math.floor(now() / 1000);
    this.setSerial(serial);
    writeDefaultCali(this.config, localAsUtc(now()) - 86400 * 30);
  }

  clock() { return (Math.floor(this.now() / 1000) + this.clockOffset) >>> 0; }
  setClock(t) { this.clockOffset = (t >>> 0) - Math.floor(this.now() / 1000); }

  serial() { return this.config[8] | (this.config[9] << 8); }
  setSerial(n) { this.config.set([n & 0xff, (n >> 8) & 0xff, 0, 0], ADDR.serial - CONFIG_BASE); }

  addShot(record) {
    if (this.shots.length >= SHOT_CAPACITY) return false;
    this.shots.push(record);
    return true;
  }

  read(addr, len) {
    const out = new Uint8Array(len).fill(0xff);
    if (addr < CONFIG_BASE) {
      const s = this.shots[addr];
      if (s) out.set(s.slice(0, len));
      return out;
    }
    const off = addr - CONFIG_BASE;
    const view = new Uint8Array(CONFIG_SIZE);
    view.set(this.config);
    const c = this.clock();
    view.set([c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, c >>> 24], 0);
    for (let i = 0; i < len && off + i < CONFIG_SIZE; i++) out[i] = view[off + i];
    return out;
  }

  // Writes to the shot area are ignored; the echo then shows the old bytes.
  write(addr, bytes) {
    if (addr < CONFIG_BASE) return;
    const off = addr - CONFIG_BASE;
    const clock = this.read(ADDR.clock, 4);
    for (let i = 0; i < bytes.length && off + i < CONFIG_SIZE; i++) {
      if (off + i < 4) clock[off + i] = bytes[i];
      else this.config[off + i] = bytes[i];
    }
    if (off < 4) this.setClock(clock[0] | (clock[1] << 8) | (clock[2] << 16) | (clock[3] << 24));
  }

  toJSON() {
    return { shots: this.shots.map(b64), config: b64(this.config), clockOffset: this.clockOffset };
  }

  static fromJSON(j, opts) {
    const m = new Memory(opts);
    m.shots = j.shots.map(unb64);
    m.config = unb64(j.config);
    m.clockOffset = j.clockOffset;
    return m;
  }
}

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Plausible factory calibration: info block at 0x9040, two sensors at 0x9080.
function writeDefaultCali(config, caliTime) {
  const i16 = (buf, at, v) => { const n = Math.round(v) & 0xffff; buf[at] = n & 0xff; buf[at + 1] = n >> 8; };
  const info = new Uint8Array(16).fill(0xff);
  info[0] = 0x55;
  info[1] = 0x01;
  info.set([caliTime & 0xff, (caliTime >>> 8) & 0xff, (caliTime >>> 16) & 0xff, caliTime >>> 24], 2);
  i16(info, 6, 0.21 * 100);
  i16(info, 8, 0.09 * 100);
  i16(info, 10, 0.48 * 100);
  i16(info, 12, 61.37 * 100);
  config.set(info, ADDR.caliInfo - CONFIG_BASE);
  const block = new Uint8Array(128).fill(0xff);
  for (let k = 0; k < 2; k++) {
    const b = [[0.0123 + k * 0.001, -0.0045, 0.0071], [-0.0312, 0.0187 - k * 0.002, 0.0405]];
    const a = [
      [[1.0012, 0.0021, -0.0008], [-0.0015, 0.9987, 0.0033], [0.0006, -0.0027, 1.0021]],
      [[0.9876, 0.0112, -0.0043], [-0.0098, 1.0134, 0.0061], [0.0029, -0.0074, 0.9951]],
    ];
    // Per axis: bias (FV) then the matrix row (FM); G first, then M.
    let at = k * 64;
    for (let gm = 0; gm < 2; gm++) {
      for (let axis = 0; axis < 3; axis++) {
        i16(block, at, b[gm][axis] * FV); at += 2;
        for (let c = 0; c < 3; c++) { i16(block, at, a[gm][axis][c] * FM); at += 2; }
      }
    }
  }
  config.set(block, ADDR.coeffs - CONFIG_BASE);
}
