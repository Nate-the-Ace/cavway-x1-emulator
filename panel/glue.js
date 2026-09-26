// Connects the Host to chrome.runtime ports and announces the panel to tabs.
export function channel(port, chrome) {
  return {
    post: (m) => { try { port.postMessage(m); } catch { /* closed */ } },
    onMessage: (cb) => port.onMessage.addListener(cb),
    onClose: (cb) => port.onDisconnect.addListener(() => { void chrome.runtime.lastError; cb(); }),
    close: () => { try { port.disconnect(); } catch { /* closed */ } },
  };
}

export async function attachHost(host, chrome) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'presence') host.addPresence(channel(port, chrome));
    else if (port.name === 'wire') host.addWire(channel(port, chrome));
  });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { t: 'panel-up' }).catch(() => {});
}
