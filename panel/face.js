// Draws the Ui scene on a canvas and forwards clicks and keys to it.
import { COLS, ROWS } from '../device/ui/scene.js';
import { KEYMAP } from './keys.js';

const CELL_W = 12;
const CELL_H = 32;
const BG = '#b7c98a';
const FG = '#1f2a10';

// The B button is both arrows at once.
const EXPAND = { both: ['left', 'right'] };
const buttonsOf = (name) => EXPAND[name] ?? [name];

export function mountFace({ ui, canvas, root, note, onStateChange = () => {} }) {
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = ui.on ? BG : '#1b1d1f';
    ctx.fillRect(0, 0, w, h);
    canvas.style.opacity = String(ui.on ? 0.4 + 0.6 * (ui.backlight() / 10) : 1);
    if (!ui.on) return;
    const s = ui.scene();
    ctx.textBaseline = 'middle';
    s.rows.forEach((row, i) => {
      const y = i * CELL_H;
      const inv = s.invert.includes(i);
      if (inv) { ctx.fillStyle = FG; ctx.fillRect(0, y, w, CELL_H); }
      ctx.fillStyle = inv ? BG : FG;
      ctx.font = `${s.bold.includes(i) ? 'bold ' : ''}20px ui-monospace, Menlo, monospace`;
      for (let c = 0; c < COLS; c++) if (row[c] !== ' ') ctx.fillText(row[c], c * CELL_W + 1, y + CELL_H / 2);
    });
  }

  // On-screen buttons: pointer down is press, up/leave/cancel is release.
  const pointerHeld = new Set();
  for (const el of root.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); pointerHeld.add(b); for (const x of buttonsOf(b)) ui.press(x); draw(); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, () => { pointerHeld.delete(b); for (const x of buttonsOf(b)) ui.release(x); draw(); });
    }
  }

  // Keyboard, unless the user is typing in a field.
  // Also leave panel buttons and drawer headers alone, so Space and Enter still activate them.
  const typing = (e) => {
    const el = document.activeElement;
    if (!el) return false;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return true;
    // Panel buttons and drawer headers keep Space and Enter; the other keys still work the X1.
    if (el.tagName === 'SUMMARY' || (el.tagName === 'BUTTON' && !el.dataset.btn)) return e.key === ' ' || e.key === 'Enter';
    return false;
  };
  const held = new Set();
  window.addEventListener('keydown', (e) => {
    const b = KEYMAP[e.key];
    if (!b || e.repeat || typing(e)) return;
    e.preventDefault();
    held.add(b);
    for (const x of buttonsOf(b)) ui.press(x);
    draw();
  });
  window.addEventListener('keyup', (e) => {
    const b = KEYMAP[e.key];
    if (!b) return;
    held.delete(b);
    for (const x of buttonsOf(b)) ui.release(x);
    draw();
  });
  // Losing focus while a key is held would otherwise leave the button stuck down.
  window.addEventListener('blur', () => {
    for (const b of [...held, ...pointerHeld]) for (const x of buttonsOf(b)) ui.release(x);
    held.clear();
    pointerHeld.clear();
    draw();
  });

  // Pose and fault controls.
  const pose = ui.instrument.pose;
  for (const [id, key] of [['poseAz', 'az'], ['poseInc', 'inc'], ['poseDist', 'dist']]) {
    const el = root.querySelector(`#${id}`);
    el.value = pose[key];
    el.addEventListener('change', () => { pose[key] = Number(el.value) || 0; });
  }
  root.querySelector('#chkForceErr').addEventListener('change', (e) => { ui.instrument.forceErr = e.target.checked; });

  // The laser and calibration LEDs live in the panel; tell it when the Ui changes them.
  let lastLaser = ui.x1.laser;
  let lastCali = ui.x1.cali;
  setInterval(() => {
    ui.tick();
    if (ui.x1.laser !== lastLaser || ui.x1.cali !== lastCali) {
      lastLaser = ui.x1.laser;
      lastCali = ui.x1.cali;
      onStateChange();
    }
    for (const b of ui.takeBeeps()) note(`Beep: ${b}`);
    draw();
  }, 100);
  draw();
}
