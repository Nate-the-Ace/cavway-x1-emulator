// Splits the host byte stream into "data:" + len + payload + CR LF frames.
// Junk before a header is skipped; a frame whose CR LF is missing is dropped.
const HEAD = [0x64, 0x61, 0x74, 0x61, 0x3a]; // "data:"

export class Deframer {
  constructor() {
    this.buf = new Uint8Array(0);
    this.junkBytes = 0;
    this.badFrames = 0;
  }

  // Returns the payloads completed by these bytes.
  push(bytes) {
    const buf = new Uint8Array(this.buf.length + bytes.length);
    buf.set(this.buf);
    buf.set(bytes, this.buf.length);
    const out = [];
    let p = 0;
    for (;;) {
      const h = findHead(buf, p);
      if (h < 0) {
        // Keep a tail that could be the start of a header.
        const keep = partialHeadAt(buf);
        this.junkBytes += keep - p;
        p = keep;
        break;
      }
      this.junkBytes += h - p;
      p = h;
      if (buf.length - p < 6) break;
      const len = buf[p + 5];
      if (buf.length - p < len + 8) break;
      if (buf[p + 6 + len] === 0x0d && buf[p + 7 + len] === 0x0a) {
        out.push(buf.slice(p + 6, p + 6 + len));
        p += len + 8;
      } else {
        this.badFrames++;
        p += 1; // resync after the bad header
      }
    }
    this.buf = buf.slice(p);
    return out;
  }

  reset() { this.buf = new Uint8Array(0); }
}

function findHead(buf, from) {
  outer: for (let i = from; i + HEAD.length <= buf.length; i++) {
    for (let k = 0; k < HEAD.length; k++) if (buf[i + k] !== HEAD[k]) continue outer;
    return i;
  }
  return -1;
}

function partialHeadAt(buf) {
  for (let n = Math.min(HEAD.length - 1, buf.length); n > 0; n--) {
    let ok = true;
    for (let k = 0; k < n; k++) if (buf[buf.length - n + k] !== HEAD[k]) { ok = false; break; }
    if (ok) return buf.length - n;
  }
  return buf.length;
}
