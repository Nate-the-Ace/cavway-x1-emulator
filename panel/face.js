// Draws the Ui scene on a canvas and forwards clicks and keys to it.
import { COLS, ROWS } from '../device/ui/scene.js';
import { KEYMAP } from './keys.js';

const CELL_W = 12;
const CELL_H = 32;
const BG = '#b7c98a';
const FG = '#1f2a10';

export function mountFace({ ui, canvas, root, note }) {
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
  for (const el of root.querySelectorAll('[data-btn]')) {
    const b = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.press(b); draw(); });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(type, () => { ui.release(b); draw(); });
    }
  }

  // Keyboard, unless the user is typing in a field.
  const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  window.addEventListener('keydown', (e) => {
    const b = KEYMAP[e.key];
    if (!b || e.repeat || typing()) return;
    e.preventDefault();
    ui.press(b);
    draw();
  });
  window.addEventListener('keyup', (e) => {
    const b = KEYMAP[e.key];
    if (!b || typing()) return;
    ui.release(b);
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

  setInterval(() => {
    ui.tick();
    for (const b of ui.takeBeeps()) note(`Beep: ${b}`);
    draw();
  }, 100);
  draw();
}
