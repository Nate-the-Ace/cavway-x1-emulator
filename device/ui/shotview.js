// Decode a 64-byte shot record for display, following Shot.cs.
export const MARKS = { 7: 'None', 0: 'Feature', 1: 'Ridge', 2: 'Backsight', 3: 'Generic' };
export const MARK_CYCLE = [7, 0, 1, 2, 3];

// Accuracy error byte 45: a cleared bit means that kind of error is present.
const ERR_BITS = [[7, 'absG'], [6, 'absM'], [5, 'dip'], [4, 'angle']];

export function view(rec) {
  const i16 = (v) => (v << 16) >> 16;
  const f = rec[1];
  const hasErr = rec[45] !== 0xff;
  return {
    isLeg: (f & 0x80) === 0,
    isCali: (f & 0x01) === 0,
    isScan: (f & 0x40) !== 0,
    mark: (f >> 1) & 7,
    distance: ((rec[2] << 16) | (rec[4] << 8) | rec[3]) / 1000,
    azimuth: (((rec[6] << 8) | rec[5]) * 360) / 65535,
    inclination: (i16((rec[8] << 8) | rec[7]) * 360) / 65535,
    absG: ((rec[11] | (rec[12] << 8)) * 667) / 1000 / 16384,
    absM: ((rec[13] | (rec[14] << 8)) * 4876) / 100 / 16384,
    dip: ((rec[15] | (rec[16] << 8)) * 360) / 65535,
    time: ((rec[20] << 24) | (rec[19] << 16) | (rec[18] << 8) | rec[17]) >>> 0,
    hasErr,
    errKinds: hasErr ? ERR_BITS.filter(([bit]) => ((rec[45] >> bit) & 1) === 0).map(([, n]) => n) : [],
  };
}
