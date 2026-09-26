// Dev harness server: the flasher (unmodified files) with the shim and relay
// injected at the top of <head>, the panel with a chrome.* stub, and a page
// showing both side by side.
//   node dev/serve.mjs [port] [flasherRoot]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMU = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] ?? 8123);
const FLASHER = process.argv[3] ?? join(EMU, '..', 'cavway-assistant-web');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };

const FLASHER_INJECT = [
  '/ext/dev/chrome-stub.js',
  '/ext/shim/relay.js',
  '/ext/dev/pre-shim.js',
  '/ext/shim/serial.js',
  '/ext/dev/post-shim.js',
].map((s) => `<script src="${s}"></script>`).join('');

async function send(res, root, rel, inject = null) {
  const path = normalize(join(root, rel));
  if (!path.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(path);
    if (inject) body = Buffer.from(body.toString('utf8').replace(/<head>/i, `<head>${inject}`));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/') return send(res, EMU, 'dev/harness.html');
  if (p === '/flasher/' || p === '/flasher/index.html') return send(res, FLASHER, 'index.html', FLASHER_INJECT);
  if (p.startsWith('/flasher/')) return send(res, FLASHER, p.slice('/flasher/'.length));
  if (p === '/ext/panel/panel.html') return send(res, EMU, 'panel/panel.html', '<script src="/ext/dev/chrome-stub.js"></script>');
  if (p.startsWith('/ext/')) return send(res, EMU, p.slice('/ext/'.length));
  res.writeHead(404).end('not found');
}).listen(PORT, () => console.log(`X1 emulator harness on http://localhost:${PORT}/`));
