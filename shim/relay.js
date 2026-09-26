// Content script (isolated world): carries messages between the page's serial
// shim and the side panel that holds the X1, and keeps per-origin grants.
(function () {
  'use strict';
  const CH = '__cavwayX1Emu';
  const origin = location.origin;
  const st = { present: false, enabled: true, granted: false };
  let loaded = false;
  let presence = null; // long-lived port: disconnects when the panel closes
  let wire = null; // one open serial session
  let pendingOpenId = null;

  const toShim = (m) => window.postMessage({ [CH]: 'to-shim', m }, origin);
  const push = () => { if (loaded) toShim({ t: 'state', ...st }); };

  function setPresent(p) {
    if (st.present === p) return;
    st.present = p;
    if (!p) dropWire(true);
    push();
  }

  function connectPresence() {
    if (presence) return;
    let port;
    try { port = chrome.runtime.connect({ name: 'presence' }); } catch { setPresent(false); return; }
    presence = port;
    port.onMessage.addListener((m) => { if (m.t === 'plugged') setPresent(!!m.plugged); });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (presence === port) presence = null;
      setPresent(false);
    });
  }

  function dropWire(lost) {
    if (!wire) return;
    const w = wire;
    wire = null;
    if (pendingOpenId !== null) { toShim({ t: 'open-failed', id: pendingOpenId }); pendingOpenId = null; }
    else if (lost) toShim({ t: 'lost' });
    try { w.disconnect(); } catch { /* gone */ }
  }

  function openWire(id, options) {
    dropWire(false);
    let port;
    try { port = chrome.runtime.connect({ name: 'wire' }); } catch { toShim({ t: 'open-failed', id }); return; }
    wire = port;
    pendingOpenId = id;
    port.onMessage.addListener((m) => {
      if (wire !== port) return;
      switch (m.t) {
        case 'opened': pendingOpenId = null; toShim({ t: 'opened', id }); break;
        case 'open-failed': dropWire(false); break;
        case 'rx': toShim({ t: 'rx', bytes: Uint8Array.from(m.bytes) }); break;
        case 'lost': dropWire(true); break;
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (wire === port) dropWire(true);
    });
    port.postMessage({ t: 'open', options, origin });
  }

  async function saveGrant(on) {
    const { grants = {} } = await chrome.storage.local.get('grants');
    if (on) grants[origin] = true; else delete grants[origin];
    await chrome.storage.local.set({ grants });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[CH] !== 'to-relay') return;
    const m = e.data.m;
    switch (m.t) {
      case 'hello': push(); break;
      case 'open': openWire(m.id, m.options); break;
      case 'tx': wire?.postMessage({ t: 'tx', bytes: Array.from(m.bytes) }); break;
      case 'signals': wire?.postMessage({ t: 'signals', signals: m.signals }); break;
      case 'close':
        if (wire) { const w = wire; wire = null; w.postMessage({ t: 'close' }); try { w.disconnect(); } catch { /* gone */ } }
        break;
      case 'grant': st.granted = true; saveGrant(true); break;
      case 'forget': st.granted = false; saveGrant(false); break;
    }
  });

  // The panel announces itself when it opens.
  chrome.runtime.onMessage.addListener((m) => { if (m?.t === 'panel-up') connectPresence(); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) st.enabled = changes.enabled.newValue !== false;
    if (changes.grants) st.granted = !!changes.grants.newValue?.[origin];
    if (changes.enabled || changes.grants) push();
  });

  chrome.storage.local.get(['grants', 'enabled']).then(({ grants = {}, enabled = true }) => {
    st.granted = !!grants[origin];
    st.enabled = enabled !== false;
    loaded = true;
    push();
    connectPresence();
  });
})();
