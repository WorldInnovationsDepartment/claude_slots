import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spriteFrame, composeGrid, gridToFrame, balanceText, symbolOffset, STRIP_H, SPRITE_W, SPRITE_ROWS, SHEET, HALF_BLOCK } from '../lib/sprite-frame.js';
import { assertRect, frameToPlainText } from '../lib/frame.js';

const base = { variant: 0, offsets: [0, 8, 16], balance: 97, overlay: null };

test('spriteFrame: 10 rows × 40 cells, every cell a half block carrying both colours', () => {
  const f = spriteFrame(base);
  assertRect(f);
  assert.equal(f.width, SPRITE_W);
  assert.equal(f.lines.length, SPRITE_ROWS);
  for (const line of f.lines) {
    for (const s of line) {
      assert.ok(s.color, 'span has a top colour');
      assert.ok(s.bg, 'span has a bottom colour');
      assert.ok(/^▀+$/.test(s.text), 'span text is only half blocks');
    }
  }
  assert.equal(frameToPlainText(f).replace(/\n/g, '').length, SPRITE_W * SPRITE_ROWS);
  assert.equal(HALF_BLOCK, '▀');
});

test('spriteFrame: runs of identical colour pairs are coalesced into one span', () => {
  const f = spriteFrame(base);
  for (const line of f.lines) {
    for (let i = 1; i < line.length; i++) {
      assert.ok(!(line[i].color === line[i - 1].color && line[i].bg === line[i - 1].bg), 'adjacent spans with the same colours should have merged');
    }
  }
  const total = f.lines.reduce((n, l) => n + l.length, 0);
  assert.ok(total < SPRITE_W * SPRITE_ROWS * 0.8, `only ${total} spans for 400 cells`);
});

test('composeGrid: every pixel is painted (no transparent cells leak through the windows)', () => {
  const g = composeGrid(base);
  assert.equal(g.length, SHEET.h);
  for (const row of g) {
    assert.equal(row.length, SHEET.w);
    for (const c of row) assert.ok(c >= 0 && c < SHEET.palette.length);
  }
});

test('composeGrid: digits land at the readout position and show the clamped balance', () => {
  const { x, y } = SHEET.cabinet.readout;
  const g = composeGrid({ ...base, balance: 97 });
  // "097": the first glyph is 0 → its top-left pixel is lit; the middle column of 0's row 1 is void
  const digitColour = SHEET.digits.glyphs[0][0];
  assert.equal(g[y][x].toString(36), digitColour, 'top-left of glyph 0 is lit');
  assert.notEqual(g[y + 1][x + 1].toString(36), digitColour, 'the hole in the 0 is not lit');
  // a different balance changes the readout pixels but nothing above the readout box
  const g2 = composeGrid({ ...base, balance: 180 });
  const diffRows = new Set();
  for (let yy = 0; yy < SHEET.h; yy++) for (let xx = 0; xx < SHEET.w; xx++) if (g[yy][xx] !== g2[yy][xx]) diffRows.add(yy);
  assert.ok([...diffRows].every((r) => r >= y && r < y + SHEET.digits.h), 'only readout rows change');
  assert.equal(balanceText(1234), '999');
  assert.equal(balanceText(-5), '000');
  assert.equal(balanceText(7), '007');
});

test('composeGrid: scrolling a reel by a full strip height reproduces the same frame', () => {
  const a = composeGrid({ ...base, offsets: [5, -13, 40] });
  const b = composeGrid({ ...base, offsets: [5 + STRIP_H, -13 - STRIP_H, 40 + 3 * STRIP_H] });
  assert.deepEqual(a, b);
});

test('composeGrid: a reel at a symbol offset shows exactly that symbol in its window', () => {
  const win = SHEET.cabinet.windows[1];
  const stripRows = [];
  for (let i = 0; i < SHEET.strip.pixels.length; i += SHEET.strip.w) stripRows.push(SHEET.strip.pixels.slice(i, i + SHEET.strip.w));
  for (const sym of SHEET.strip.symbols) {
    const off = symbolOffset(sym);
    const g = composeGrid({ ...base, offsets: [0, off, 0] });
    for (let y = 0; y < win.h; y++) {
      const shown = g[win.y + y].slice(win.x, win.x + win.w).map((c) => c.toString(36)).join('');
      assert.equal(shown, stripRows[off + y], `${sym} row ${y}`);
    }
  }
});

test('composeGrid: an overlay replaces only its painted pixels', () => {
  const plain = composeGrid(base);
  const withOverlay = composeGrid({ ...base, overlay: { id: 'win-life', frame: 2 } });
  const ov = SHEET.overlays['win-life'][2];
  let changed = 0;
  for (let y = 0; y < SHEET.h; y++) {
    for (let x = 0; x < SHEET.w; x++) {
      const painted = ov[y * SHEET.w + x] !== '-';
      if (!painted) assert.equal(withOverlay[y][x], plain[y][x], `(${x},${y}) untouched`);
      else if (withOverlay[y][x] !== plain[y][x]) changed++;
    }
  }
  assert.ok(changed > 0);
  // frame index wraps
  assert.deepEqual(composeGrid({ ...base, overlay: { id: 'lose', frame: 10 } }), composeGrid({ ...base, overlay: { id: 'lose', frame: 0 } }));
});

test('gridToFrame: pairs pixel rows into cells and never leaves a cell without colours', () => {
  const g = [[0, 1], [-1, 2]];
  const f = gridToFrame(g);
  assert.equal(f.lines.length, 1);
  assert.deepEqual(f.lines[0].map((s) => [s.text, s.color, s.bg]), [
    ['▀', SHEET.palette[0], SHEET.palette[0]],
    ['▀', SHEET.palette[1], SHEET.palette[2]],
  ]);
});
