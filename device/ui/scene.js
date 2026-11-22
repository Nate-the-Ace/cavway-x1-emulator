// What the UI model draws: a text grid. Phase 3 will add real pixels.
export const COLS = 21;
export const ROWS = 8;

// Left text and right text on one row; the left side is clipped to make room.
export function lr(left, right) {
  const room = Math.max(0, COLS - right.length);
  return left.slice(0, room).padEnd(room) + right;
}

export function scene(rows = [], { invert = [], bold = [] } = {}) {
  const out = Array.from({ length: ROWS }, (_, i) => (rows[i] ?? '').padEnd(COLS).slice(0, COLS));
  return { rows: out, invert: [...invert], bold: [...bold] };
}

export const sceneText = (s) => s.rows.map((r) => r.trimEnd()).join('\n');
