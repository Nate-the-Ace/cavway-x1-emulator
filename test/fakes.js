// A fake browser for end-to-end tests: one page window (with the shim and
// relay loaded from their real files) and a chrome.* that links the relay's
// runtime ports to the panel's onConnect. Messages hop asynchronously and go
// through a JSON round trip, as extension messaging does.
import { readFileSync } from 'node:fs';

const tick = (fn) => setTimeout(fn, 0);
const json = (m) => JSON.parse(JSON.stringify(m));

class Hook {
  constructor() { this.fns = []; }
  addListener(fn) { this.fns.push(fn); }
  emit(...a) { for (const f of [...this.fns]) f(...a); }
}

function portPair(name) {
  const mk = () => ({ name, onMessage: new Hook(), onDisconnect: new Hook(), _open: true });
  const a = mk(), b = mk();
  for (const [x, y] of [[a, b], [b, a]]) {
    x.postMessage = (m) => {
      if (!x._open) throw new Error('Attempting to use a disconnected port object');
      const c = json(m);
      tick(() => { if (y._open) y.onMessage.emit(c, y); });
    };
    x.disconnect = () => {
      if (!x._open) return;
      x._open = false;
      tick(() => { if (y._open) { y._open = false; y.onDisconnect.emit(y); } });
    };
  }
  return [a, b];
}

export function makeChrome() {
  const onConnect = new Hook();
  const onMessage = new Hook();
  const onChanged = new Hook();
  const store = {};
  let panelOpen = false;
  const chrome = {
    runtime: {
      lastError: undefined,
      onConnect,
      onMessage,
      connect({ name }) {
        const [mine, theirs] = portPair(name);
        if (panelOpen) tick(() => onConnect.emit(theirs));
        else tick(() => { mine._open = false; mine.onDisconnect.emit(mine); });
        return mine;
      },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (id, m) => { tick(() => onMessage.emit(json(m))); },
    },
    storage: {
      onChanged,
      local: {
        get: async (keys) => {
          const ks = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(ks.filter((k) => k in store).map((k) => [k, json(store[k])]));
        },
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: json(v) }; store[k] = json(v); }
          tick(() => onChanged.emit(changes, 'local'));
        },
      },
    },
    _setPanelOpen(v) { panelOpen = v; },
    _store: store,
  };
  return chrome;
}

// A page with the shim and relay installed; returns its navigator.
export function makePage(chrome, { origin = 'https://nate-the-ace.github.io', choose = 'emulated' } = {}) {
  const win = new EventTarget();
  win.isSecureContext = true;
  win.top = win;
  win.postMessage = (data) => {
    const d = structuredClone(data);
    tick(() => {
      const ev = new Event('message');
      Object.defineProperty(ev, 'data', { value: d });
      Object.defineProperty(ev, 'source', { value: win });
      win.dispatchEvent(ev);
    });
  };
  class Navigator {}
  const nav = new Navigator();
  const activation = { isActive: true };
  nav.userActivation = activation;
  const location = { origin, host: new URL(origin).host };
  const page = { win, nav, activation, location, chooserAnswer: choose, choices: [] };

  const relay = readFileSync(new URL('../shim/relay.js', import.meta.url), 'utf8');
  const quietInterval = (fn, ms) => { const t = setInterval(fn, ms); t.unref(); return t; };
  new Function('window', 'location', 'chrome', 'setInterval', relay)(win, location, chrome, quietInterval);
  globalThis.__CVX1_TEST__ = {};
  new Function(readFileSync(new URL('../shim/serial.js', import.meta.url), 'utf8'))();
  const { install } = globalThis.__CVX1_TEST__;
  win.location = location;
  page.api = install(win, nav, Navigator, async (opts) => { page.choices.push(opts); return page.chooserAnswer; });
  return page;
}
