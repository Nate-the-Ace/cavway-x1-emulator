const pad = (n, w = 2) => String(n).padStart(w, '0');

export function fmtAngle(deg, unit = 'deg') {
  return unit === 'grad' ? `${((deg * 400) / 360).toFixed(1)}g` : `${deg.toFixed(1)}°`;
}

export function fmtDist(m, unit = 'm') {
  return unit === 'ft' ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(3)} m`;
}

// Device clock seconds are "local time as UTC", so read them with the UTC getters.
export function fmtDate(t) {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtTime(t) {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
