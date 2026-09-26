// The hub inside the side panel: the X1's USB plug. Pages reach it through
// channels ({ post, onMessage, onClose, close }); one serial session at a time,
// as an OS serial port is exclusive.
import { Wire } from '../device/wire.js';

export class Host {
  constructor({ x1, now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h), onTraffic = () => {}, onChange = () => {}, onLog = () => {} }) {
    Object.assign(this, { x1, now, setTimer, clearTimer, onTraffic, onChange, onLog });
    this.plugged = false;
    this.presences = new Set();
    this.session = null; // { ch, wire, origin, options }
    x1.on((type, detail) => {
      if (type === 'unplug') this.setPlugged(false);
      if (type === 'log') this.onLog(detail);
    });
  }

  setPlugged(p) {
    if (p === this.plugged) return;
    this.plugged = p;
    if (!p) this._killSession();
    for (const ch of this.presences) ch.post({ t: 'plugged', plugged: p });
    this.onLog(p ? 'Plugged in' : 'Unplugged');
    this.onChange();
  }

  addPresence(ch) {
    this.presences.add(ch);
    ch.onClose(() => this.presences.delete(ch));
    if (this.plugged) ch.post({ t: 'plugged', plugged: true });
  }

  addWire(ch) {
    ch.onMessage((m) => {
      const mine = this.session?.ch === ch;
      switch (m.t) {
        case 'open': {
          // Unplugged: stay silent, another window's panel may hold the X1.
          if (!this.plugged) return;
          if (this.session) {
            this.onLog(`Open refused: port busy (${m.origin})`);
            ch.post({ t: 'open-failed' });
            return;
          }
          const wire = new Wire({
            x1: this.x1,
            now: this.now,
            setTimer: this.setTimer,
            clearTimer: this.clearTimer,
            deliver: (b) => ch.post({ t: 'rx', bytes: Array.from(b) }),
            onTraffic: this.onTraffic,
          });
          wire.open(m.options);
          this.session = { ch, wire, origin: m.origin, options: m.options };
          const o = m.options;
          this.onLog(`Opened by ${m.origin} at ${o.baudRate} ${o.dataBits}${o.parity[0].toUpperCase()}${o.stopBits}${wire.lineOk ? '' : ' (line mismatch: garbled)'}`);
          ch.post({ t: 'opened' });
          this.onChange();
          break;
        }
        case 'tx': if (mine) this.session.wire.hostWrite(Uint8Array.from(m.bytes)); break;
        case 'signals': if (mine) this.onLog(`Signals ${JSON.stringify(m.signals)}`); break;
        case 'close': if (mine) { this._endSession(); this.onLog('Closed by host'); } break;
      }
    });
    ch.onClose(() => { if (this.session?.ch === ch) { this._endSession(); this.onLog('Host went away'); } });
  }

  // Bytes the device sends on its own (a live shot), if a host has the port.
  sendUnsolicited(bytes) {
    this.session?.wire.deviceSend(bytes);
  }

  // Timed faults: unplug after a delay.
  unplugAfter(ms) {
    this.setTimer(() => this.setPlugged(false), ms);
  }

  _endSession() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.wire.close();
    this.onChange();
  }

  _killSession() {
    const s = this.session;
    if (!s) return;
    s.ch.post({ t: 'lost' });
    this._endSession();
    s.ch.close();
  }
}
