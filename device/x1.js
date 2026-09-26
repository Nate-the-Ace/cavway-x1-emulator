// The emulated X1: host frames in, timed replies out, plus the panel's buttons.
// Written from the upstream C# host (UART.cs, FrmMain.cs, FrmFirmware.cs); it
// shares no code with the flasher on purpose.
import { Deframer } from './framing.js';
import { Memory } from './memory.js';
import { Firmware } from './firmware.js';
import { encodeShot, Flag } from './shots.js';
import { makeRng } from './rng.js';

// Device processing times in ms (guesses until measured on hardware).
export const TIMING = { mem: 3, cmd: 1, fwStart: 400, fwPacket: 6, fwEnd: 1200 };

export const Cmd = { EnterCali: 0x30, QuitCali: 0x31, LaserOn: 0x36, LaserOff: 0x37, LaserTrig: 0x38 };

export const defaultFaults = () => ({
  seed: 1,
  latencyMs: 0,
  jitterMs: 0,
  corruptToHost: 0, // per-byte probability
  corruptToDevice: 0,
  dropReplyRate: 0,
  freeze: false,
  dropNextReply: false, // one-shot
  strayNext: false, // one-shot
  fwNakAt: null,
  fwBadCrcAt: null,
  fwStallAt: null,
  fwUnplugAt: null,
  fwSlowStartMs: 0,
  fwRejectEnd: false,
});

export const defaultSettings = () => ({ streamLive: true, brickOnAbort: true });

export class X1 {
  constructor({ now = () => Date.now(), rng = null, memory = null, firmware = null, faults = null, settings = null } = {}) {
    this.now = now;
    this.faults = { ...defaultFaults(), ...faults };
    this.rng = rng ?? makeRng(this.faults.seed);
    this.settings = { ...defaultSettings(), ...settings };
    this.memory = memory ?? new Memory({ now });
    this.firmware = firmware ?? new Firmware();
    this.deframer = new Deframer();
    this.laser = false;
    this.cali = false;
    this.hostOpen = false;
    this.walk = { az: 40, inc: -5, n: 0 };
    this.listeners = new Set();
  }

  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  _emit(type, detail) { for (const cb of this.listeners) cb(type, detail); }
  _changed() { this._emit('change', this.state()); }

  hostOpened() {
    this.hostOpen = true;
    this.deframer.reset();
    this._changed();
  }

  hostClosed() {
    this.hostOpen = false;
    this.deframer.reset();
    this.laser = false;
    this.firmware.abort('host disconnected', this.settings.brickOnAbort);
    this._changed();
  }

  // Bytes from the host, returns [{ bytes, delayMs }] to send back in order.
  receive(bytes) {
    const out = [];
    for (const pl of this.deframer.push(bytes)) {
      for (const r of this._handle(pl) ?? []) out.push(r);
    }
    this._changed();
    return out;
  }

  _handle(pl) {
    if (pl.length === 0) return null;
    if (this.faults.freeze) { this._emit('log', 'Frozen: ignored a frame'); return null; }
    const op = pl[0];
    const fwOp = op === 0x4b || op === 0x4c || op === 0x4d;
    if (this.firmware.state === 'bootloader' && !fwOp) { this._emit('log', 'Bootloader: ignored a non-firmware frame'); return null; }
    if (this.firmware.receiving && !fwOp) { this._emit('log', 'Flashing: ignored a non-firmware frame'); return null; }
    const now = this.now();
    switch (op) {
      case 0x3d:
      case 0x3e: {
        if (pl.length < 4) return null;
        const addr = pl[1] | (pl[2] << 8), n = pl[3];
        if (op === 0x3e) this.memory.write(addr, pl.slice(4, 4 + n));
        const reply = new Uint8Array(4 + n);
        reply.set([0x3d, pl[1], pl[2], n]);
        reply.set(this.memory.read(addr, n), 4);
        const out = [];
        if (this.faults.strayNext) {
          this.faults.strayNext = false;
          out.push({ bytes: this._livePacket(this.memory.shots.at(-1) ?? encodeShot({ time: this.memory.clock(), distance: 1, azimuth: 0, inclination: 0 })), delayMs: 0 });
          this._emit('log', 'Fault: stray packet before reply');
        }
        if (this._dropReply()) return out;
        out.push({ bytes: reply, delayMs: TIMING.mem });
        return out;
      }
      case Cmd.LaserOn: this.laser = true; return null;
      case Cmd.LaserOff: this.laser = false; return null;
      case Cmd.EnterCali: this.cali = true; return null;
      case Cmd.QuitCali: this.cali = false; return null;
      case Cmd.LaserTrig: {
        const live = this.measure();
        return live ? [{ bytes: live, delayMs: 250 }] : null;
      }
      case 0x4b: {
        const reply = this.firmware.start(now);
        if (this._dropReply()) return null;
        return [{ bytes: reply, delayMs: TIMING.fwStart + this.faults.fwSlowStartMs }];
      }
      case 0x4c: {
        const idx = pl[1] | (pl[2] << 8);
        if (this.faults.fwUnplugAt === idx && this.firmware.receiving) {
          this._emit('log', `Fault: unplug at packet ${idx}`);
          this._emit('unplug');
          return null;
        }
        if (this.faults.fwStallAt === idx && this.firmware.receiving) {
          this.firmware.lastActivity = now;
          this._emit('log', `Fault: stalled at packet ${idx}`);
          return null;
        }
        const { reply } = this.firmware.packet(pl, now, {
          nak: this.faults.fwNakAt === idx,
          badCrc: this.faults.fwBadCrcAt === idx,
        });
        if (this._dropReply()) return null;
        return [{ bytes: reply, delayMs: TIMING.fwPacket }];
      }
      case 0x4d: {
        const reply = this.firmware.end(pl, now, { reject: this.faults.fwRejectEnd, brickOnAbort: this.settings.brickOnAbort });
        if (this._dropReply()) return null;
        return [{ bytes: reply, delayMs: TIMING.fwEnd }];
      }
      default:
        this._emit('log', `Unknown command 0x${op.toString(16).padStart(2, '0')}`);
        return null;
    }
  }

  _dropReply() {
    if (this.faults.dropNextReply) {
      this.faults.dropNextReply = false;
      this._emit('log', 'Fault: dropped reply');
      return true;
    }
    if (this.faults.dropReplyRate > 0 && this.rng() < this.faults.dropReplyRate) {
      this._emit('log', 'Fault: dropped reply');
      return true;
    }
    return false;
  }

  // Unsolicited packet sent when a shot is taken (format is a guess).
  _livePacket(record) {
    const p = new Uint8Array(67);
    p[0] = (record[1] & 1) === 0 ? 0x02 : 0x01;
    p.set(record, 1);
    p[65] = 0x0d;
    p[66] = 0x0a;
    return p;
  }

  // The Measure button or a laser trigger. Returns the live packet to stream,
  // or null. Blank values follow a gentle random walk.
  measure({ splay = false, flag = Flag.none, distance = null, azimuth = null, inclination = null } = {}) {
    if (this.firmware.state !== 'app') return null;
    const r = this.rng;
    const w = this.walk;
    if (!splay) {
      w.az = (w.az + (r() - 0.5) * 60 + 360) % 360;
      w.inc = Math.max(-45, Math.min(45, w.inc + (r() - 0.5) * 20));
    }
    const record = encodeShot({
      time: this.memory.clock(),
      distance: distance ?? (splay ? 0.5 + r() * 2.5 : 2 + r() * 6),
      azimuth: azimuth ?? (splay ? (w.az + 90 + r() * 180) % 360 : w.az),
      inclination: inclination ?? (splay ? (r() - 0.5) * 60 : w.inc),
      splay,
      cali: this.cali,
      flag,
      absG: 1 + (r() - 0.5) * 0.004,
      absM: 48 + (r() - 0.5) * 0.6,
      dip: 60 + (r() - 0.5) * 0.8,
      roll: (r() - 0.5) * 20,
      noise: Math.round(r() * 30),
    });
    this.laser = false;
    const stored = this.memory.addShot(record);
    this._emit('log', stored ? `Shot ${this.memory.shots.length} taken` : 'Memory full: shot not stored');
    this._changed();
    return this.hostOpen && this.settings.streamLive ? this._livePacket(record) : null;
  }

  tick() {
    if (this.firmware.tick(this.now(), this.settings.brickOnAbort)) this._changed();
  }

  factoryReset() {
    const serial = this.memory.serial();
    this.memory = new Memory({ now: this.now, serial });
    this.firmware = new Firmware();
    this.laser = false;
    this.cali = false;
    this._changed();
  }

  state() {
    const fw = this.firmware;
    return {
      laser: this.laser,
      cali: this.cali,
      hostOpen: this.hostOpen,
      shots: this.memory.shots.length,
      serial: this.memory.serial(),
      clock: this.memory.clock(),
      fw: {
        state: fw.state,
        received: fw.packets.length,
        crcFailures: fw.crcFailures,
        lastResult: fw.lastResult,
        installed: fw.installed,
      },
      junkBytes: this.deframer.junkBytes,
      badFrames: this.deframer.badFrames,
    };
  }

  toJSON() { return { memory: this.memory.toJSON(), firmware: this.firmware.toJSON() }; }

  static fromJSON(j, opts = {}) {
    return new X1({
      ...opts,
      memory: Memory.fromJSON(j.memory, { now: opts.now }),
      firmware: Firmware.fromJSON(j.firmware),
    });
  }
}
