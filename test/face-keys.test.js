import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP } from '../panel/keys.js';

test('keyboard map', () => {
  assert.equal(KEYMAP[' '], 'dist');
  assert.equal(KEYMAP.Enter, 'dist');
  assert.equal(KEYMAP.ArrowLeft, 'left');
  assert.equal(KEYMAP.ArrowRight, 'right');
  assert.equal(KEYMAP.m, 'm');
  assert.equal(KEYMAP.M, 'm');
  assert.equal(KEYMAP.Escape, 'clr');
  assert.equal(KEYMAP.Backspace, 'clr');
});
