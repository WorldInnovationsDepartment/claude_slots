// Sprite sheet contract tests (docs/ART-SPEC.md, openspec sprite-art-pipeline).
// They run against the committed lib/sprites.json, never against Remotion, so
// `node --test` needs nothing from art/node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET_PATH = path.join(ROOT, 'lib', 'sprites.json');
const PALETTE_TS = path.join(ROOT, 'art', 'src', 'palette.ts');

const sheet = JSON.parse(fs.readFileSync(SHEET_PATH, 'utf8'));
const { w: W, h: H } = sheet;

/** Palette hexes as the composition's theme declares them, in order (regex on the pure-data TS file; no TS execution needed). */
function themePalette() {
  const src = fs.readFileSync(PALETTE_TS, 'utf8');
  return [...src.matchAll(/hex:\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
}

const toIndex = (ch) => (ch === '-' ? -1 : parseInt(ch, 36));
const rowsOf = (pixels, w) => {
  const rows = [];
  for (let i = 0; i < pixels.length; i += w) rows.push(pixels.slice(i, i + w));
  return rows;
};
/** The w×h window of a vertical strip starting at row `off`, rows wrapping (what the engine's reel scroll does). */
function stripWindow(strip, off, h) {
  const rows = rowsOf(strip.pixels, strip.w);
  const out = [];
  for (let y = 0; y < h; y++) out.push(rows[(((off + y) % strip.h) + strip.h) % strip.h]);
  return out.join('\n');
}

test('geometry: every frame is 40 × 20 pixels, i.e. 10 rows of 40 half-block cells', () => {
  assert.equal(W, 40);
  assert.equal(H, 20);
  assert.equal(H % 2, 0, 'height must pair into half-block rows');
  assert.equal(H / 2, 10);
  for (const [i, f] of sheet.cabinet.frames.entries()) assert.equal(f.length, W * H, `cabinet frame ${i}`);
  for (const [id, frames] of Object.entries(sheet.overlays)) {
    for (const [i, f] of frames.entries()) assert.equal(f.length, W * H, `overlay ${id}[${i}]`);
  }
  assert.equal(sheet.strip.pixels.length, sheet.strip.w * sheet.strip.h);
  for (const g of sheet.digits.glyphs) assert.equal(g.length, sheet.digits.w * sheet.digits.h);
});

test('size budget: the sheet file is 400 KB or smaller', () => {
  assert.ok(fs.statSync(SHEET_PATH).size <= 400 * 1024);
});

test('palette: at most 24 colours, every one declared in the composition theme, every pixel index in range', () => {
  assert.ok(sheet.palette.length <= 24, `palette has ${sheet.palette.length} entries`);
  const theme = themePalette();
  assert.deepEqual(sheet.palette.map((h) => h.toUpperCase()), theme, 'sheet palette must equal the theme palette, in order');
  const used = new Set();
  const everything = [
    ...sheet.cabinet.frames,
    sheet.strip.pixels,
    ...sheet.digits.glyphs,
    ...Object.values(sheet.overlays).flat(),
  ].join('');
  for (const ch of everything) {
    const idx = toIndex(ch);
    if (idx === -1) continue;
    assert.ok(idx >= 0 && idx < sheet.palette.length, `pixel char ${ch} is outside the palette`);
    used.add(idx);
  }
  assert.ok(used.size <= 24);
});

test('layer inventory: 4+ cabinet variants, 3 windows, a readout, 6 symbol offsets, 10 digit glyphs, 6 overlay sequences', () => {
  assert.ok(sheet.cabinet.frames.length >= 4);
  assert.equal(sheet.cabinet.windows.length, 3);
  for (const win of sheet.cabinet.windows) {
    assert.equal(win.w, sheet.strip.w, 'window width equals strip width');
    assert.equal(win.h, sheet.strip.symbolH, 'window height equals one symbol');
    assert.ok(win.x >= 0 && win.x + win.w <= W && win.y >= 0 && win.y + win.h <= H);
  }
  assert.ok(Number.isInteger(sheet.cabinet.readout.x) && Number.isInteger(sheet.cabinet.readout.y));
  assert.deepEqual(sheet.strip.symbols, ['FEATURE', 'CLIENT', 'LIFE', 'SKULL', 'EDDIES', 'CHIP']);
  for (const s of sheet.strip.symbols) assert.ok(Number.isInteger(sheet.strip.offsets[s]), `offset for ${s}`);
  assert.equal(sheet.digits.glyphs.length, 10);
  assert.deepEqual(Object.keys(sheet.overlays).sort(), ['abort', 'error', 'lose', 'win-client', 'win-feature', 'win-life']);
  for (const frames of Object.values(sheet.overlays)) assert.ok(frames.length >= 8, 'each overlay is at least 8 frames (0.8 s at 10 fps)');
});

test('cabinet: reel windows are transparent, everything else is painted', () => {
  const inWindow = (x, y) => sheet.cabinet.windows.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  for (const [v, frame] of sheet.cabinet.frames.entries()) {
    for (let i = 0; i < frame.length; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (inWindow(x, y)) assert.equal(frame[i], '-', `variant ${v} (${x},${y}) inside a window must be transparent`);
      else assert.notEqual(frame[i], '-', `variant ${v} (${x},${y}) outside the windows must be painted`);
    }
  }
});

test('strip: scrolling a window by one full strip height reproduces the starting frame (no seam)', () => {
  const h = sheet.strip.symbolH;
  for (let off = 0; off < sheet.strip.h; off += 5) {
    assert.equal(stripWindow(sheet.strip, off + sheet.strip.h, h), stripWindow(sheet.strip, off, h), `offset ${off}`);
  }
  assert.equal(sheet.strip.h, sheet.strip.symbols.length * sheet.strip.symbolH);
});

test('strip: each declared offset lands its symbol exactly in a window, and the six symbols are distinct', () => {
  const h = sheet.strip.symbolH;
  const seen = new Map();
  for (const sym of sheet.strip.symbols) {
    const off = sheet.strip.offsets[sym];
    assert.equal(off % h, 0, `${sym} offset is symbol-aligned`);
    const shown = stripWindow(sheet.strip, off, h);
    assert.ok(/[^-\n]/.test(shown), `${sym} draws something`);
    assert.ok(!shown.includes('-'), `${sym} fills its window (no transparent pixels inside a symbol)`);
    assert.ok(!seen.has(shown), `${sym} must not look identical to ${seen.get(shown)}`);
    seen.set(shown, sym);
  }
});

test('cabinet: grain differs between variants while the outline (transparency + frame pixels) is identical', () => {
  const frames = sheet.cabinet.frames;
  const steel = new Set(['7', '8'].map((c) => c)); // steel + steelLight indices 7/8 → chars '7','8'
  const mask = (f) => [...f].map((ch) => (ch === '-' ? 'T' : steel.has(ch) ? 'S' : 'b')).join('');
  for (let v = 1; v < frames.length; v++) {
    assert.equal(mask(frames[v]), mask(frames[0]), `variant ${v} outline`);
    let diff = 0;
    for (let i = 0; i < frames[0].length; i++) if (frames[v][i] !== frames[0][i]) diff++;
    assert.ok(diff > 0, `variant ${v} must differ from variant 0 (grain)`);
    assert.ok(diff < frames[0].length / 4, `variant ${v} differs in ${diff} pixels; grain should be sparse`);
  }
});

test('cabinet: scanlines darken alternate rows of the body', () => {
  const frame = sheet.cabinet.frames[0];
  const rows = rowsOf(frame, W);
  // body pixels are palette 3 (body) on even rows and 4 (bodyScan) on odd rows, grain aside
  const bodyOnRow = (y) => [...rows[y]].filter((c) => c === '3' || c === '4');
  const even = bodyOnRow(12);
  const odd = bodyOnRow(13);
  assert.ok(even.length > 0 && odd.length > 0);
  assert.ok(even.every((c) => c === '3'), 'even rows use the plain body colour');
  assert.ok(odd.every((c) => c === '4'), 'odd rows use the darker scanline colour');
});

test('overlays: transparent where they do not paint, and the reels stay visible underneath', () => {
  const win = sheet.cabinet.windows;
  const windowCells = win.reduce((n, r) => n + r.w * r.h, 0);
  for (const [id, frames] of Object.entries(sheet.overlays)) {
    for (const [i, f] of frames.entries()) {
      assert.ok(f.includes('-'), `${id}[${i}] has transparent pixels`);
      let coveredInWindows = 0;
      for (const r of win) {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (f[y * W + x] !== '-') coveredInWindows++;
      }
      assert.ok(coveredInWindows < windowCells * 0.5, `${id}[${i}] covers ${coveredInWindows} reel pixels; reels must stay visible`);
    }
  }
});

test('digits: every glyph is 3 × 5 and distinct, drawn in one colour', () => {
  const seen = new Set();
  for (const [d, g] of sheet.digits.glyphs.entries()) {
    assert.equal(g.length, 15);
    const inks = new Set([...g].filter((c) => c !== '-'));
    assert.equal(inks.size, 1, `digit ${d} uses one colour`);
    assert.ok(!seen.has(g), `digit ${d} is unique`);
    seen.add(g);
  }
  assert.equal(sheet.digits.stride, 4);
});
