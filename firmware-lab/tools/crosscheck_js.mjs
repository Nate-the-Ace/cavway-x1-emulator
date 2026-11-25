// Cross-check tools/uploader.py against the JS port in ../cavway-assistant-web/src/firmware.js.
// Usage: node tools/crosscheck_js.mjs FILE...
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const fw = await import(path.resolve(here, '../../../cavway-assistant-web/src/firmware.js'));
for (const f of process.argv.slice(2)) {
  const b = new Uint8Array(readFileSync(f));
  const p = fw.buildPackets(b);
  const h = fw.checkHeader ? fw.checkHeader(b) : null;
  console.log(f, 'packets', p.length, 'checksum 0x' + fw.checksum(p).toString(16).padStart(8, '0'), 'header', JSON.stringify(h));
}
