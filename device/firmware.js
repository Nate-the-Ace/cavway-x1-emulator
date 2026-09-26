// Firmware receiver (0x4B start, 0x4C packet, 0x4D end) and bootloader state.
// app -> receiving -> app on success; an interrupted flash leaves the device in
// the bootloader ("bricked") when brickOnAbort is set.
import { crc16modbus } from './crc.js';

export const IDLE_ABORT_MS = 10000;

export class Firmware {
  constructor() {
    this.state = 'app';
    this.packets = [];
    this.sum = 0;
    this.crcFailures = 0;
    this.lastResult = null;
    this.installed = null; // { size, sum, packets, at }
    this.image = null;
    this.lastActivity = 0;
  }

  get receiving() { return this.state === 'receiving'; }

  start(now) {
    this.state = 'receiving';
    this.packets = [];
    this.sum = 0;
    this.crcFailures = 0;
    this.lastActivity = now;
    this.lastResult = 'Receiving';
    return Uint8Array.of(0x4b, 0x01);
  }

  // Returns { reply, status } where status 0 = ok. faults may corrupt the echo.
  packet(pl, now, { nak = false, badCrc = false } = {}) {
    const idx = pl[1] | (pl[2] << 8);
    const data = pl.slice(3, 131);
    const sent = pl[131] | (pl[132] << 8);
    let crc = pl.length >= 133 ? crc16modbus(data) : 0;
    let ok = this.receiving && pl.length >= 133 && crc === sent && idx === this.packets.length;
    if (nak) ok = false;
    if (ok) {
      this.packets.push(data);
      this.sum = (this.sum + crc) >>> 0;
    } else if (this.receiving) {
      this.crcFailures++;
    }
    if (badCrc) crc ^= 0x5a5a;
    this.lastActivity = now;
    return { reply: Uint8Array.of(0x4c, pl[1], pl[2], ok ? 0x00 : 0x01, crc & 0xff, crc >> 8), ok };
  }

  end(pl, now, { reject = false, brickOnAbort = true } = {}) {
    const sum = (pl[1] | (pl[2] << 8) | (pl[3] << 16) | (pl[4] << 24)) >>> 0;
    const ok = this.receiving && !reject && sum === this.sum && this.packets.length > 0;
    if (ok) {
      this.image = new Uint8Array(this.packets.length * 128);
      this.packets.forEach((d, i) => this.image.set(d, i * 128));
      this.installed = { size: this.image.length, sum: this.sum, packets: this.packets.length, at: now };
      this.state = 'app';
      this.lastResult = `Installed ${this.packets.length} packets`;
    } else if (this.receiving) {
      this.abort('Checksum rejected', brickOnAbort);
    } else {
      this.lastResult = 'End without start';
    }
    this.packets = [];
    return Uint8Array.of(0x4d, ok ? 0x00 : 0x01);
  }

  abort(reason, brickOnAbort) {
    if (!this.receiving) return;
    this.state = brickOnAbort ? 'bootloader' : 'app';
    this.packets = [];
    this.lastResult = `Aborted: ${reason}`;
  }

  // Receiving but silent too long counts as an interrupted flash.
  tick(now, brickOnAbort) {
    if (this.receiving && now - this.lastActivity > IDLE_ABORT_MS) {
      this.abort('host went quiet', brickOnAbort);
      return true;
    }
    return false;
  }

  recover() {
    this.state = 'app';
    this.packets = [];
    this.lastResult = null;
  }

  toJSON() { return { state: this.state === 'receiving' ? 'bootloader' : this.state, installed: this.installed }; }
  static fromJSON(j) {
    const f = new Firmware();
    f.state = j?.state ?? 'app';
    f.installed = j?.installed ?? null;
    return f;
  }
}
