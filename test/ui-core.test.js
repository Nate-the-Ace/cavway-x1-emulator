import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './ui-helpers.js';

test('dark until DIST, then shows the device date and time', () => {
  const r = rig();
  r.tap('m');
  assert.equal(r.ui.on, false);
  assert.equal(r.text().trim(), '');
  r.tap('dist');
  assert.equal(r.ui.on, true);
  const iso = new Date(r.x1.memory.clock() * 1000).toISOString();
  assert.match(r.text(), new RegExp(iso.slice(0, 10)));
  assert.match(r.text(), new RegExp(iso.slice(11, 19)));
  assert.equal(r.ui.backlight(), 10);
});

test('long CLR powers off and clears laser and calibration state', () => {
  const r = rig();
  r.tap('dist');
  r.x1.laser = true;
  r.x1.cali = true;
  r.tap('clr');
  assert.equal(r.ui.on, true, 'a short CLR does not power off');
  r.hold('clr', 2000);
  assert.equal(r.ui.on, false);
  assert.equal(r.x1.laser, false);
  assert.equal(r.x1.cali, false);
  assert.equal(r.ui.backlight(), 0);
});

test('idle power-off follows the setting and any press resets it', () => {
  const r = rig();
  r.tap('dist');
  r.run(50_000);
  r.tap('m');
  r.run(50_000);
  assert.equal(r.ui.on, true);
  r.run(11_000);
  assert.equal(r.ui.on, false);
});

test('a long press fires once and its release does nothing', () => {
  const r = rig();
  r.tap('dist');
  r.hold('dist', 2500);
  assert.equal(r.name(), 'HomeScreen');
});

test('DIST+M held together is a chord, not two long presses', () => {
  const r = rig();
  r.tap('dist');
  const seen = [];
  r.ui.screen.key = (ui, b, kind) => seen.push(`${b}:${kind}`);
  r.ui.press('dist');
  r.ui.press('m');
  r.run(2100);
  r.ui.release('dist');
  r.ui.release('m');
  assert.deepEqual(seen, ['dist+m:chord']);
});

test('beep is silent when switched off', () => {
  const r = rig();
  r.ui.beep('short');
  r.ui.settings.beep = false;
  r.ui.beep('long');
  assert.deepEqual(r.ui.takeBeeps(), ['short']);
  assert.deepEqual(r.ui.takeBeeps(), []);
});
