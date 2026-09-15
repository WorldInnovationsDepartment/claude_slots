import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, padEnd, padStart, truncate } from '../lib/width.js';

test('displayWidth: ASCII, box-drawing, geometric, and the eight symbol glyphs are single-width', () => {
  for (const ch of ['A', 'z', '0', ' ', '┌', '─', '┐', '│', '└', '┘', '╔', '═', '╗', '║', '╚', '╝', '╠', '╣', '▐', '▌', '●', '○', '★', '☆', '✻', '♦', '♣', '☼', '♥']) {
    assert.equal(displayWidth(ch), 1, `expected ${JSON.stringify(ch)} to be width 1`);
  }
  assert.equal(displayWidth('BAR'), 3);
  assert.equal(displayWidth('◆C◆'), 3);
});

test('displayWidth: East Asian Wide / Fullwidth and emoji-presentation codepoints are width 2', () => {
  assert.equal(displayWidth('中'), 2);
  assert.equal(displayWidth('あ'), 2);
  assert.equal(displayWidth('한'), 2);
  assert.equal(displayWidth('✨'), 2); // emoji-presentation dingbat used by the opt-in theme (§14)
  assert.equal(displayWidth('🏅'), 2);
  assert.equal(displayWidth('中文'), 4);
});

test('displayWidth: combining marks and zero-width codepoints contribute 0', () => {
  assert.equal(displayWidth('é'), 1); // e + combining acute = 1 visual column
  assert.equal(displayWidth('​'), 0); // zero-width space
  assert.equal(displayWidth('‍'), 0); // ZWJ
  assert.equal(displayWidth(''), 0);
});

test('displayWidth: a variation selector can force emoji (wide) or text (narrow) presentation', () => {
  assert.equal(displayWidth('❤️'), 2); // heart + VS-16 -> emoji presentation
  assert.equal(displayWidth('❤︎'), 1); // heart + VS-15 -> text presentation
});

test('padEnd / padStart pad to the requested display width, not string length', () => {
  assert.equal(padEnd('中', 4, '.'), '中..'); // 中 is 2 columns wide, so 2 fill chars reach width 4
  assert.equal(displayWidth(padEnd('中', 4, '.')), 4);
  assert.equal(padStart('中', 4, '.'), '..中');
  assert.equal(padEnd('already-wide-enough', 3), 'already-wide-enough'); // no-op, already over budget
});

test('truncate: cuts by display width and never splits a wide glyph', () => {
  assert.equal(truncate('hello world', 8, '…'), 'hello w…');
  assert.equal(displayWidth(truncate('中中中中', 5)), 4); // a 5th half-glyph would overflow; dropped whole
  assert.equal(truncate('short', 10), 'short');
});
