// 64-byte shot records, laid out as Shot.cs decodes them.
export const G_SCALE = 667;
export const M_SCALE = 4876;
export const FM = 16384;
export const Flag = { feature: 0, ridge: 1, backsight: 2, generic: 3, none: 7 };

const RAW_G = 16000; // counts per g (a guess; only needs to look plausible)
const RAW_M = 9000;
const rad = (d) => (d * Math.PI) / 180;
const put16 = (s, i, v) => { s[i] = v & 0xff; s[i + 1] = (v >> 8) & 0xff; };
const angle16 = (deg) => Math.round((deg * 65535) / 360) & 0xffff;

export function encodeShot({
  time, distance, azimuth, inclination, splay = false, cali = false, scan = false, flag = Flag.none,
  absG = 1, absM = 48, dip = 60, roll = 0, noise = 0, err = null,
}) {
  const s = new Uint8Array(64).fill(0xff);
  s[0] = 0x00;
  s[1] = (splay ? 0x80 : 0) | (scan ? 0x40 : 0) | ((flag & 7) << 1) | (cali ? 0 : 1);
  const mm = Math.max(0, Math.min(0xffffff, Math.round(distance * 1000)));
  s[2] = (mm >> 16) & 0xff;
  s[3] = mm & 0xff;
  s[4] = (mm >> 8) & 0xff;
  put16(s, 5, angle16(((azimuth % 360) + 360) % 360));
  put16(s, 7, angle16(inclination));
  s[9] = 0; s[10] = 0;
  put16(s, 11, Math.round((absG * 1000 * FM) / G_SCALE));
  put16(s, 13, Math.round((absM * 100 * FM) / M_SCALE));
  put16(s, 15, angle16(dip));
  const t = time >>> 0;
  s[17] = t & 0xff; s[18] = (t >>> 8) & 0xff; s[19] = (t >>> 16) & 0xff; s[20] = t >>> 24;
  const inc = rad(inclination), az = rad(azimuth), r = rad(roll);
  // Gravity and field in the instrument frame (x along the laser).
  const g = [Math.sin(inc), Math.sin(r) * Math.cos(inc), Math.cos(r) * Math.cos(inc)];
  const m = [Math.cos(az) * Math.cos(inc), Math.sin(az), Math.cos(az) * Math.sin(inc) + 1.2];
  for (let k = 0; k < 2; k++) {
    const vals = [...g.map((v) => v * RAW_G * absG), ...m.map((v) => v * RAW_M)];
    vals.forEach((v, i) => put16(s, 21 + k * 12 + i * 2, Math.round(v + (k ? noise : -noise)) & 0xffff));
  }
  if (err) s.set(err.slice(0, 9), 45);
  return s;
}
