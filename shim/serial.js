// A stand-in for navigator.serial, installed in the page's own JS world before
// any page script runs. It follows the Web Serial spec as Chrome implements it
// and only moves bytes; the X1 itself lives in the extension's side panel.
// Classic script (content scripts cannot be modules); tests load it with vm.
(function (root) {
  'use strict';
  const CH = '__cavwayX1Emu';
  const INFO = Object.freeze({ usbVendorId: 0x1a86, usbProductId: 0x55d3 }); // WCH CH343
  const MAX_BUFFER = 16 * 1024 * 1024;

  function createWebSerial(env) {
    const { post, realSerial, userActivation, choose, DOMException: DOMEx } = env;
    const state = { known: false, present: false, enabled: true, granted: false };
    let stateWaiters = [];
    let current = null; // the SerialPort for the currently plugged-in X1
    let nextId = 1;
    const pendingOpen = new Map();

    const domErr = (name, msg) => new DOMEx(msg, name);

    function addHandlerProps(target, names) {
      for (const name of names) {
        let fn = null;
        Object.defineProperty(target, 'on' + name, {
          configurable: true,
          enumerable: true,
          get: () => fn,
          set: (v) => {
            if (fn) target.removeEventListener(name, fn);
            fn = typeof v === 'function' ? v : null;
            if (fn) target.addEventListener(name, fn);
          },
        });
      }
    }

    // Fires on the port, then bubbles to navigator.serial with target === port.
    function fire(port, type) {
      port.dispatchEvent(new Event(type, { bubbles: true }));
      const ev = new Event(type, { bubbles: true });
      Object.defineProperty(ev, 'target', { get: () => port });
      serial.dispatchEvent(ev);
    }

    function whenStateKnown(ms = 300) {
      if (state.known) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { clearTimeout(t); resolve(); };
        const t = setTimeout(() => { stateWaiters = stateWaiters.filter((w) => w !== done); resolve(); }, ms);
        stateWaiters.push(done);
      });
    }

    function matches(filters) {
      if (!filters || filters.length === 0) return true;
      return filters.some((f) =>
        f.bluetoothServiceClassId === undefined &&
        (f.usbVendorId === undefined || f.usbVendorId === INFO.usbVendorId) &&
        (f.usbProductId === undefined || f.usbProductId === INFO.usbProductId));
    }

    function checkFilters(filters) {
      if (filters === undefined) return;
      for (const f of filters) {
        if (f.usbVendorId === undefined && f.usbProductId === undefined && f.bluetoothServiceClassId === undefined) {
          throw new TypeError("Failed to execute 'requestPort' on 'Serial': A filter must provide a property to filter by.");
        }
        if (f.usbProductId !== undefined && f.usbVendorId === undefined) {
          throw new TypeError("Failed to execute 'requestPort' on 'Serial': A filter containing a usbProductId must also specify a usbVendorId.");
        }
      }
    }

    const currentPort = () => {
      if (!current || current._dead) current = new SerialPort();
      return current;
    };

    class SerialPort extends EventTarget {
      constructor() {
        super();
        this._state = 'closed';
        this._lost = false;
        this._dead = false;
        this._readable = null;
        this._writable = null;
        this._rc = null;
        this._early = [];
        this._session = 0;
        addHandlerProps(this, ['connect', 'disconnect']);
      }
      get [Symbol.toStringTag]() { return 'SerialPort'; }
      get connected() { return !this._dead && state.present; }
      // Chrome recreates a stream after a non-fatal error or cancel while open.
      get readable() {
        if (!this._readable && this._state === 'open' && !this._lost) this._readable = this._makeReadable();
        return this._readable;
      }
      get writable() {
        if (!this._writable && this._state === 'open' && !this._lost) this._writable = this._makeWritable();
        return this._writable;
      }
      getInfo() { return { ...INFO }; }

      async open(options) {
        const o = validateOpen(options);
        if (this._state !== 'closed') throw domErr('InvalidStateError', 'The port is already open.');
        if (this._dead || !state.present) throw domErr('NetworkError', 'Failed to open serial port.');
        this._state = 'opening';
        const id = nextId++;
        const ok = await new Promise((resolve) => {
          pendingOpen.set(id, resolve);
          post({ t: 'open', id, options: o });
        });
        if (!ok || this._dead) {
          this._state = 'closed';
          throw domErr('NetworkError', 'Failed to open serial port.');
        }
        this._session = id;
        this._lost = false;
        this._state = 'open';
        this._bufferSize = o.bufferSize;
      }

      _makeReadable() {
        const port = this;
        return new ReadableStream({
          type: 'bytes',
          start(c) {
            port._rc = c;
            for (const b of port._early.splice(0)) c.enqueue(b);
          },
          cancel() { port._rc = null; port._readable = null; },
        }, { highWaterMark: this._bufferSize });
      }

      _makeWritable() {
        const port = this;
        const fail = (e) => { port._writable = null; throw e; };
        return new WritableStream({
          write(chunk) {
            let bytes;
            if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk.slice(0));
            else if (ArrayBuffer.isView(chunk)) bytes = new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
            else fail(new TypeError("The provided value is not of type '(ArrayBuffer or ArrayBufferView)'."));
            if (port._lost) throw domErr('NetworkError', 'The device has been lost.');
            post({ t: 'tx', bytes });
          },
          close() { port._writable = null; },
          abort() { port._writable = null; },
        }, { highWaterMark: this._bufferSize, size: (c) => c.byteLength ?? 1 });
      }

      // Bytes that arrive before the page asks for readable wait, as in Chrome's pipe.
      _rx(bytes) {
        if (this._state !== 'open' || this._lost) return;
        if (this._rc) this._rc.enqueue(new Uint8Array(bytes));
        else this._early.push(new Uint8Array(bytes));
      }

      // Unplugged: streams fail, both become null, the port is dead for good.
      _unplug() {
        if (this._dead) return;
        this._dead = true;
        for (const resolve of pendingOpen.values()) resolve(false);
        pendingOpen.clear();
        if (this._state === 'open') {
          this._lost = true;
          const e = domErr('NetworkError', 'The device has been lost.');
          try { this._rc?.error(e); } catch { /* already closed */ }
          this._rc = null;
          const w = this._writable;
          this._readable = null;
          this._writable = null;
          if (w && !w.locked) w.abort(e).catch(() => {});
        }
        if (state.granted) fire(this, 'disconnect');
      }

      async close() {
        if (this._state !== 'open') throw domErr('InvalidStateError', 'The port is already closed.');
        if (this._readable?.locked) throw new TypeError("Failed to execute 'close' on 'SerialPort': Cannot cancel a locked stream");
        if (this._writable?.locked) throw new TypeError("Failed to execute 'close' on 'SerialPort': Cannot close a locked stream");
        this._state = 'closing';
        try { await this._readable?.cancel(); } catch { /* gone */ }
        try { await this._writable?.close(); } catch { /* gone */ }
        this._readable = null;
        this._writable = null;
        this._rc = null;
        if (!this._lost) post({ t: 'close' });
        this._state = 'closed';
      }

      async setSignals(signals = {}) {
        if (this._state !== 'open') throw domErr('InvalidStateError', 'The port is closed.');
        if (!['dataTerminalReady', 'requestToSend', 'break'].some((k) => signals[k] !== undefined)) {
          throw new TypeError("Failed to execute 'setSignals' on 'SerialPort': Signals dictionary is empty.");
        }
        if (this._lost) throw domErr('NetworkError', 'The device has been lost.');
        post({ t: 'signals', signals: { ...signals } });
      }

      async getSignals() {
        if (this._state !== 'open') throw domErr('InvalidStateError', 'The port is closed.');
        if (this._lost) throw domErr('NetworkError', 'The device has been lost.');
        return { dataCarrierDetect: false, clearToSend: false, ringIndicator: false, dataSetReady: false };
      }

      async forget() {
        state.granted = false;
        post({ t: 'forget' });
        if (this._state === 'open' && !this._lost) {
          try { this._rc?.close(); } catch { /* closed */ }
          post({ t: 'close' });
        }
        this._state = 'closed';
        this._dead = true;
        this._readable = null;
        this._writable = null;
      }
    }

    function validateOpen(options) {
      const fail = (m) => { throw new TypeError("Failed to execute 'open' on 'SerialPort': " + m); };
      if (options === null || typeof options !== 'object') fail("1 argument required, but only 0 present.");
      if (options.baudRate === undefined) fail("Failed to read the 'baudRate' property from 'SerialOptions': Required member is undefined.");
      const o = {
        baudRate: Number(options.baudRate),
        dataBits: options.dataBits ?? 8,
        stopBits: options.stopBits ?? 1,
        parity: options.parity ?? 'none',
        bufferSize: options.bufferSize ?? 255,
        flowControl: options.flowControl ?? 'none',
      };
      if (!(o.baudRate > 0)) fail('Requested baud rate must be greater than zero.');
      if (o.dataBits !== 7 && o.dataBits !== 8) fail('Requested number of data bits must be 7 or 8.');
      if (o.stopBits !== 1 && o.stopBits !== 2) fail('Requested number of stop bits must be 1 or 2.');
      if (!['none', 'even', 'odd'].includes(o.parity)) fail(`The provided value '${o.parity}' is not a valid enum value of type ParityType.`);
      if (!['none', 'hardware'].includes(o.flowControl)) fail(`The provided value '${o.flowControl}' is not a valid enum value of type FlowControlType.`);
      if (!(o.bufferSize > 0)) fail('Requested buffer size must be greater than zero.');
      if (o.bufferSize > MAX_BUFFER) fail(`Requested buffer size (${o.bufferSize} bytes) is greater than the maximum allowed (${MAX_BUFFER} bytes).`);
      return o;
    }

    class Serial extends EventTarget {
      constructor() {
        super();
        addHandlerProps(this, ['connect', 'disconnect']);
      }
      get [Symbol.toStringTag]() { return 'Serial'; }

      async requestPort(options = {}) {
        checkFilters(options?.filters);
        if (!userActivation?.isActive) {
          throw domErr('SecurityError', 'Must be handling a user gesture to show a permission request.');
        }
        await whenStateKnown();
        if (!state.enabled) {
          if (!realSerial) throw domErr('NotFoundError', 'No port selected by the user.');
          return realSerial.requestPort(options);
        }
        const choice = await choose({ emulated: state.present && matches(options?.filters), real: !!realSerial });
        if (choice === 'emulated' && state.present) {
          state.granted = true;
          post({ t: 'grant' });
          return currentPort();
        }
        if (choice === 'real' && realSerial) return realSerial.requestPort(options);
        throw domErr('NotFoundError', 'No port selected by the user.');
      }

      async getPorts() {
        await whenStateKnown();
        const ports = state.enabled && state.present && state.granted ? [currentPort()] : [];
        if (realSerial) ports.push(...(await realSerial.getPorts()));
        return ports;
      }
    }

    const serial = new Serial();

    // Real ports' plug events still reach the page through our object.
    if (realSerial) {
      for (const type of ['connect', 'disconnect']) {
        realSerial.addEventListener(type, (e) => {
          const ev = new Event(type, { bubbles: true });
          Object.defineProperty(ev, 'target', { get: () => e.target });
          serial.dispatchEvent(ev);
        });
      }
    }

    function receive(m) {
      switch (m?.t) {
        case 'state': {
          const was = state.present;
          state.present = !!m.present;
          state.enabled = m.enabled !== false;
          state.granted = !!m.granted;
          state.known = true;
          const w = stateWaiters;
          stateWaiters = [];
          w.forEach((f) => f());
          if (was && !state.present) current?._unplug();
          if (!was && state.present && state.granted && state.enabled) fire(currentPort(), 'connect');
          break;
        }
        case 'opened':
        case 'open-failed': {
          const r = pendingOpen.get(m.id);
          pendingOpen.delete(m.id);
          r?.(m.t === 'opened');
          break;
        }
        case 'rx':
          current?._rx(m.bytes);
          break;
        case 'lost':
          current?._unplug();
          break;
      }
    }

    return { serial, receive, SerialPort, Serial };
  }

  // Chrome-like port chooser in a closed shadow root. Resolves 'emulated',
  // 'real' or null.
  function domChooser({ emulated, real }) {
    return new Promise((resolve) => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'closed' });
      const origin = location.host || location.origin;
      shadow.innerHTML = `
<style>
  :host { all: initial; }
  .scrim { position: fixed; inset: 0; z-index: 2147483647; display: flex; justify-content: center; align-items: flex-start; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .box { margin-top: 12px; width: 400px; max-width: calc(100vw - 32px); background: #fff; color: #202124; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.28); padding: 16px; }
  @media (prefers-color-scheme: dark) { .box { background: #292a2d; color: #e8eaed; } .list { border-color: #5f6368; } li[aria-selected="true"] { background: #394457; } .btn { color: #8ab4f8; border-color: #5f6368; } .primary { background: #8ab4f8; color: #202124; } }
  h1 { font-size: 15px; font-weight: 500; margin: 0 0 12px; }
  .list { list-style: none; margin: 0 0 16px; padding: 0; border: 1px solid #dadce0; border-radius: 4px; min-height: 80px; }
  li { padding: 8px 12px; cursor: default; }
  li[aria-selected="true"] { background: #e8f0fe; }
  .empty { color: #80868b; padding: 8px 12px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { font: inherit; border: 1px solid #dadce0; background: transparent; color: #1a73e8; border-radius: 4px; padding: 6px 16px; cursor: pointer; }
  .primary { background: #1a73e8; color: #fff; border-color: transparent; }
  .btn:disabled { opacity: .4; cursor: default; }
  .note { font-size: 11px; color: #80868b; margin: -8px 0 12px; }
</style>
<div class="scrim"><div class="box" role="dialog" aria-label="Serial port chooser">
  <h1>${origin} wants to connect to a serial port</h1>
  <ul class="list" role="listbox"></ul>
  <p class="note">Cavway X1 Emulator</p>
  <div class="row"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="connect" disabled>Connect</button></div>
</div></div>`;
      const list = shadow.querySelector('.list');
      const connect = shadow.querySelector('[data-a="connect"]');
      let picked = null;
      const items = [];
      if (emulated) items.push(['emulated', 'Cavway X1 (emulated) – USB 1a86:55d3']);
      if (real) items.push(['real', 'Real serial ports…']);
      if (!emulated) list.insertAdjacentHTML('afterbegin', '<li class="empty">No compatible devices found.</li>');
      for (const [id, label] of items) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = label;
        li.addEventListener('click', () => {
          picked = id;
          for (const x of list.querySelectorAll('li')) x.setAttribute('aria-selected', String(x === li));
          connect.disabled = false;
        });
        li.addEventListener('dblclick', () => finish(id));
        list.appendChild(li);
      }
      const finish = (v) => {
        document.removeEventListener('keydown', onKey, true);
        host.remove();
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
      document.addEventListener('keydown', onKey, true);
      shadow.querySelector('[data-a="cancel"]').addEventListener('click', () => finish(null));
      connect.addEventListener('click', () => finish(picked));
      (document.body || document.documentElement).appendChild(host);
    });
  }

  // Replaces navigator.serial in this window and links it to the relay.
  function install(win, nav, NavigatorCtor, choose) {
    const origin = win.location.origin;
    const api = createWebSerial({
      post: (m) => win.postMessage({ [CH]: 'to-relay', m }, origin),
      realSerial: nav.serial ?? null,
      userActivation: nav.userActivation,
      choose,
      DOMException,
    });
    win.addEventListener('message', (e) => {
      if (e.source === win && e.data && e.data[CH] === 'to-shim') api.receive(e.data.m);
    });
    Object.defineProperty(NavigatorCtor.prototype, 'serial', { configurable: true, enumerable: true, get() { return api.serial; } });
    win.postMessage({ [CH]: 'to-relay', m: { t: 'hello' } }, origin);
    return api;
  }

  if (root.__CVX1_TEST__) {
    Object.assign(root.__CVX1_TEST__, { createWebSerial, install, domChooser });
    return;
  }
  if (typeof window === 'undefined' || !window.isSecureContext || window.top !== window) return;
  install(window, navigator, Navigator, domChooser);
})(globalThis);
