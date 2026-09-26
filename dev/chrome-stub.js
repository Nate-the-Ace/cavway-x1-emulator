// Dev harness only: a tiny chrome.* over BroadcastChannel + localStorage, so
// the panel and a flasher page on the same localhost origin can talk as the
// extension's side panel and content script would.
(function () {
  'use strict';
  const bc = new BroadcastChannel('cvx1-dev');
  const hook = () => {
    const fns = [];
    return {
      addListener: (f) => fns.push(f),
      removeListener: (f) => { const i = fns.indexOf(f); if (i >= 0) fns.splice(i, 1); },
      hasListeners: () => fns.length > 0,
      emit: (...a) => fns.slice().forEach((f) => f(...a)),
    };
  };
  const onConnect = hook(), onMessage = hook(), onChanged = hook();
  const ports = new Map(); // `${id}:${side}` -> port
  const clone = (m) => JSON.parse(JSON.stringify(m));

  function makePort(id, side, name) {
    const peer = side === 'a' ? 'b' : 'a';
    const p = {
      name,
      onMessage: hook(),
      onDisconnect: hook(),
      _open: true,
      postMessage(m) {
        if (!p._open) throw new Error('Attempting to use a disconnected port object');
        bc.postMessage({ k: 'msg', key: `${id}:${peer}`, m: clone(m) });
      },
      disconnect() {
        if (!p._open) return;
        p._open = false;
        ports.delete(`${id}:${side}`);
        bc.postMessage({ k: 'disc', key: `${id}:${peer}` });
      },
    };
    ports.set(`${id}:${side}`, p);
    return p;
  }

  bc.onmessage = ({ data: d }) => {
    if (d.k === 'connect' && onConnect.hasListeners()) {
      const p = makePort(d.id, 'b', d.name);
      bc.postMessage({ k: 'ack', key: `${d.id}:a` });
      onConnect.emit(p);
    } else if (d.k === 'ack') {
      const p = ports.get(d.key);
      if (p) p._acked = true;
    } else if (d.k === 'msg') {
      const p = ports.get(d.key);
      if (p?._open) p.onMessage.emit(d.m, p);
    } else if (d.k === 'disc') {
      const p = ports.get(d.key);
      if (p?._open) { p._open = false; ports.delete(d.key); p.onDisconnect.emit(p); }
    } else if (d.k === 'tabmsg') {
      onMessage.emit(d.m, {}, () => {});
    }
  };

  // Tell the other side our ports are gone when this document goes away.
  addEventListener('pagehide', () => { for (const p of [...ports.values()]) p.disconnect(); });

  const PREFIX = 'cvx1:';
  addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const k = e.key.slice(PREFIX.length);
    onChanged.emit({ [k]: { oldValue: e.oldValue && JSON.parse(e.oldValue), newValue: e.newValue && JSON.parse(e.newValue) } }, 'local');
  });

  window.chrome = {
    runtime: {
      lastError: undefined,
      onConnect,
      onMessage,
      connect({ name }) {
        const id = Math.random().toString(36).slice(2);
        const p = makePort(id, 'a', name);
        bc.postMessage({ k: 'connect', id, name });
        setTimeout(() => {
          if (!p._acked && p._open) { p._open = false; ports.delete(`${id}:a`); p.onDisconnect.emit(p); }
        }, 150);
        return p;
      },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (id, m) => { bc.postMessage({ k: 'tabmsg', m: clone(m) }); },
    },
    storage: {
      onChanged,
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of typeof keys === 'string' ? [keys] : keys) {
            const v = localStorage.getItem(PREFIX + k);
            if (v !== null) out[k] = JSON.parse(v);
          }
          return out;
        },
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            const old = localStorage.getItem(PREFIX + k);
            localStorage.setItem(PREFIX + k, JSON.stringify(v));
            changes[k] = { oldValue: old && JSON.parse(old), newValue: clone(v) };
          }
          onChanged.emit(changes, 'local');
        },
      },
    },
  };
})();
