// The serial line between host and X1: 8N1 byte timing both ways, USB
// full-speed frames (1 ms, <= 64 bytes) towards the host, line faults, and
// garbage when the host opens the port with the wrong settings.
export const DEVICE_BAUD = 115200;
export const BYTE_MS = (10 * 1000) / DEVICE_BAUD; // start + 8 data + stop bits
export const USB_PACKET = 64;

export class Wire {
  constructor({ x1, now, setTimer, clearTimer, deliver, onTraffic = () => {} }) {
    Object.assign(this, { x1, now, setTimer, clearTimer, deliver, onTraffic });
    this.timers = new Set();
    this.queue = []; // { b, t } bytes in flight towards the host
    this.txBusy = 0;
    this.rxBusy = 0;
    this.frameTimer = null;
    this.closed = true;
    this.lineOk = true;
  }

  get faults() { return this.x1.faults; }
  get rng() { return this.x1.rng; }

  open({ baudRate, dataBits = 8, stopBits = 1, parity = 'none' }) {
    this.lineOk = baudRate === DEVICE_BAUD && dataBits === 8 && stopBits === 1 && parity === 'none';
    this.closed = false;
    this.x1.hostOpened();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.timers) this.clearTimer(h);
    this.timers.clear();
    this.frameTimer = null;
    this.queue = [];
    this.x1.hostClosed();
  }

  _at(time, fn) {
    const h = this.setTimer(() => { this.timers.delete(h); if (!this.closed) fn(); }, Math.max(0, time - this.now()));
    this.timers.add(h);
    return h;
  }

  _mangle(bytes, rate) {
    const out = Uint8Array.from(bytes);
    for (let i = 0; i < out.length; i++) {
      if (!this.lineOk) out[i] = Math.floor(this.rng() * 256);
      else if (rate > 0 && this.rng() < rate) out[i] ^= 1 << Math.floor(this.rng() * 8);
    }
    return out;
  }

  hostWrite(bytes) {
    if (this.closed) return;
    const start = Math.max(this.now(), this.txBusy);
    this.txBusy = start + bytes.length * BYTE_MS;
    const data = this._mangle(bytes, this.faults.corruptToDevice);
    this._at(this.txBusy, () => {
      this.onTraffic('in', data);
      let t = this.now();
      for (const r of this.x1.receive(data)) {
        t += r.delayMs + this.faults.latencyMs + this.rng() * this.faults.jitterMs;
        this._at(t, () => this.deviceSend(r.bytes));
      }
    });
  }

  // Device -> host: bytes finish one by one at line rate; each 1 ms USB
  // frame carries whatever has finished, in packets of up to 64 bytes.
  deviceSend(bytes) {
    if (this.closed) return;
    const data = this._mangle(bytes, this.faults.corruptToHost);
    this.onTraffic('out', data);
    let t = Math.max(this.now(), this.rxBusy);
    for (const b of data) { t += BYTE_MS; this.queue.push({ b, t }); }
    this.rxBusy = t;
    this._scheduleFrame();
  }

  _scheduleFrame() {
    if (this.frameTimer || this.queue.length === 0) return;
    const at = Math.max(Math.ceil(this.queue[0].t), Math.floor(this.now()) + 1);
    this.frameTimer = this._at(at, () => this._frame());
  }

  _frame() {
    this.frameTimer = null;
    const now = this.now();
    let n = 0;
    while (n < this.queue.length && this.queue[n].t <= now) n++;
    const ready = this.queue.splice(0, n).map((q) => q.b);
    for (let i = 0; i < ready.length; i += USB_PACKET) this.deliver(Uint8Array.from(ready.slice(i, i + USB_PACKET)));
    this._scheduleFrame();
  }
}
