#!/usr/bin/env node
// Claude Slots — sprite sheet build (scripts/dev/build-sprites.js)
//
// Renders every machine layer from the Remotion project in art/ (the single
// source of the art), decodes the PNGs, quantises every pixel to an exact
// palette index, and writes:
//
//   lib/sprites.json          the sheet (≤ 400 KB), read by the tests
//   lib/sprites.js            the same sheet as an ES module: the mod loader
//                             only imports code files, never JSON
//   docs/sprites-contact.png  a contact sheet of every layer for human review
//
// Deterministic: the composition uses no randomness, rendering is pixel-exact
// against the declared palette (any off-palette pixel is an error, never a
// nearest-colour guess), and the JSON is emitted in a fixed key order, so two
// runs on the same composition are byte-identical.
//
// Usage:
//   node scripts/dev/build-sprites.js [--browser-executable=<path>] [--keep]
//
// Requires `npm install` inside art/ (Remotion is confined there; the plugin
// itself never loads it). The renderer is driven through @remotion/renderer's
// API rather than one CLI spawn per layer so the bundle is built once.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, encodePng } from './png.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ART = path.join(ROOT, 'art');
const OUT_JSON = path.join(ROOT, 'lib', 'sprites.json');
const OUT_JS = path.join(ROOT, 'lib', 'sprites.js');
const OUT_CONTACT = path.join(ROOT, 'docs', 'sprites-contact.png');
const SIZE_BUDGET = 400 * 1024;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

const artRequire = createRequire(path.join(ART, 'package.json'));
const { bundle } = artRequire('@remotion/bundler');
const { renderStill, renderFrames, selectComposition } = artRequire('@remotion/renderer');

// Geometry + palette come straight from the composition's own modules (pure
// TypeScript data, loaded through Node's type stripping) so this script can
// never drift from what was rendered.
const palette = (await import(pathToFileURL(path.join(ART, 'src', 'palette.ts')))).PALETTE;
const layout = await import(pathToFileURL(path.join(ART, 'src', 'machine', 'layout.ts')));
const symbols = await import(pathToFileURL(path.join(ART, 'src', 'machine', 'symbol-grid.ts')));
const overlays = await import(pathToFileURL(path.join(ART, 'src', 'machine', 'overlay-grid.ts')));
const cabinetMod = await import(pathToFileURL(path.join(ART, 'src', 'machine', 'cabinet-grid.ts')));
const digitsMod = await import(pathToFileURL(path.join(ART, 'src', 'machine', 'digits-grid.ts')));

if (palette.length > 36) throw new Error('palette has more than 36 entries; one base-36 char per pixel cannot encode it');
const hexToIndex = new Map(palette.map((p, i) => [p.hex.toUpperCase(), i]));
const indexToChar = (i) => i.toString(36);

function overlayCompId(id) {
  return 'Overlay' + id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
}

/** Quantise an RGBA buffer into a row-major string of palette chars ('-' = transparent). */
function quantise(name, { width, height, rgba }) {
  let out = '';
  const bad = [];
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 128) {
      out += '-';
      continue;
    }
    const hex = '#' + [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const idx = hexToIndex.get(hex);
    if (idx === undefined) {
      bad.push(`${name} (${i % width},${Math.floor(i / width)}) ${hex} a=${a}`);
      out += '-';
      continue;
    }
    out += indexToChar(idx);
  }
  if (bad.length) throw new Error(`off-palette pixels in ${name}:\n  ${bad.slice(0, 20).join('\n  ')}${bad.length > 20 ? `\n  …and ${bad.length - 20} more` : ''}`);
  return out;
}

function expectSize(name, img, w, h) {
  if (img.width !== w || img.height !== h) throw new Error(`${name}: rendered ${img.width}×${img.height}, expected ${w}×${h}`);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slots-sprites-'));
  const browserExecutable = typeof args['browser-executable'] === 'string' ? args['browser-executable'] : null;
  const common = { browserExecutable, logLevel: 'error', chromiumOptions: { gl: 'swangle' } };

  console.log('bundling art/ …');
  const serveUrl = await bundle({ entryPoint: path.join(ART, 'src', 'index.ts'), logLevel: 'error' });

  async function still(id) {
    const composition = await selectComposition({ serveUrl, id, ...common });
    const output = path.join(tmp, `${id}.png`);
    await renderStill({ composition, serveUrl, output, imageFormat: 'png', ...common });
    return decodePng(fs.readFileSync(output));
  }

  async function sequence(id) {
    const composition = await selectComposition({ serveUrl, id, ...common });
    const outputDir = path.join(tmp, id);
    fs.mkdirSync(outputDir, { recursive: true });
    await renderFrames({ composition, serveUrl, outputDir, imageFormat: 'png', ...common });
    const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.png')).sort();
    if (files.length !== composition.durationInFrames) throw new Error(`${id}: ${files.length} frames rendered, expected ${composition.durationInFrames}`);
    return files.map((f) => decodePng(fs.readFileSync(path.join(outputDir, f))));
  }

  const W = layout.W;
  const H = layout.H;
  const sheet = {
    palette: palette.map((p) => p.hex),
    w: W,
    h: H,
    cabinet: { frames: [], windows: layout.WINDOWS.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })), readout: { x: layout.READOUT.x, y: layout.READOUT.y } },
    strip: { symbols: [...symbols.SYMBOL_IDS], symbolH: layout.SYMBOL_H, w: layout.WINDOW_W, h: layout.SYMBOL_H * symbols.SYMBOL_IDS.length, offsets: {}, pixels: '' },
    digits: { w: 3, h: 5, stride: digitsMod.DIGIT_STRIDE, glyphs: [] },
    overlays: {},
  };
  for (const id of symbols.SYMBOL_IDS) sheet.strip.offsets[id] = symbols.symbolOffset(id);

  const images = { cabinet: [], strip: null, digits: null, overlays: {} };

  for (let v = 0; v < cabinetMod.CABINET_VARIANTS; v++) {
    const id = `SpriteCabinet${v}`;
    process.stdout.write(`render ${id} … `);
    const img = await still(id);
    expectSize(id, img, W, H);
    sheet.cabinet.frames.push(quantise(id, img));
    images.cabinet.push(img);
    console.log('ok');
  }

  process.stdout.write('render SpriteStrip … ');
  images.strip = await still('SpriteStrip');
  expectSize('SpriteStrip', images.strip, sheet.strip.w, sheet.strip.h);
  sheet.strip.pixels = quantise('SpriteStrip', images.strip);
  console.log('ok');

  process.stdout.write('render SpriteDigits … ');
  images.digits = await still('SpriteDigits');
  expectSize('SpriteDigits', images.digits, digitsMod.DIGITS_W, digitsMod.DIGITS_H);
  const digitsStr = quantise('SpriteDigits', images.digits);
  for (let d = 0; d < 10; d++) {
    let glyph = '';
    for (let y = 0; y < 5; y++) glyph += digitsStr.slice(y * digitsMod.DIGITS_W + d * digitsMod.DIGIT_STRIDE, y * digitsMod.DIGITS_W + d * digitsMod.DIGIT_STRIDE + 3);
    sheet.digits.glyphs.push(glyph);
  }
  console.log('ok');

  for (const id of overlays.OVERLAY_IDS) {
    const compId = overlayCompId(id);
    process.stdout.write(`render ${compId} … `);
    const frames = await sequence(compId);
    frames.forEach((img, i) => expectSize(`${compId}[${i}]`, img, W, H));
    sheet.overlays[id] = frames.map((img, i) => quantise(`${compId}[${i}]`, img));
    images.overlays[id] = frames;
    console.log(`ok (${frames.length} frames)`);
  }

  const json = JSON.stringify(sheet);
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, json + '\n');
  const size = Buffer.byteLength(json) + 1;
  console.log(`wrote ${path.relative(ROOT, OUT_JSON)} (${size} bytes)`);
  fs.writeFileSync(
    OUT_JS,
    '// GENERATED by scripts/dev/build-sprites.js from art/ — do not edit; rebuild instead.\n' +
      '// Identical to sprites.json, wrapped as a module because the mod loader imports code files only.\n' +
      'export default ' + json + ';\n',
  );
  console.log(`wrote ${path.relative(ROOT, OUT_JS)}`);
  if (size > SIZE_BUDGET) throw new Error(`sprites.json is ${size} bytes, over the ${SIZE_BUDGET} byte budget`);

  writeContactSheet(images);
  console.log(`wrote ${path.relative(ROOT, OUT_CONTACT)}`);

  if (!args.keep) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log(`kept renders in ${tmp}`);
}

/** Lays every rendered layer out on one RGBA canvas at 4× and writes it as a PNG. */
function writeContactSheet(images) {
  const SCALE = 4;
  const GAP = 8;
  const BG = [0x07, 0x07, 0x0b, 0xff];
  const CHECK = [0x30, 0x30, 0x40, 0xff]; // transparent pixels show as a checker so holes are visible

  const rows = [];
  rows.push(images.cabinet);
  rows.push([images.strip, images.digits]);
  for (const id of Object.keys(images.overlays)) rows.push(images.overlays[id]);

  const rowW = (row) => row.reduce((w, img) => w + img.width * SCALE + GAP, GAP);
  const rowH = (row) => Math.max(...row.map((img) => img.height * SCALE)) + GAP;
  const width = Math.max(...rows.map(rowW));
  const height = rows.reduce((h, row) => h + rowH(row), GAP);
  const canvas = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) canvas.set(BG, i * 4);

  let y0 = GAP;
  for (const row of rows) {
    let x0 = GAP;
    for (const img of row) {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const s = (y * img.width + x) * 4;
          const transparent = img.rgba[s + 3] < 128;
          const px = transparent ? ((x + y) % 2 ? CHECK : BG) : [img.rgba[s], img.rgba[s + 1], img.rgba[s + 2], 255];
          for (let dy = 0; dy < SCALE; dy++) {
            for (let dx = 0; dx < SCALE; dx++) {
              const o = ((y0 + y * SCALE + dy) * width + (x0 + x * SCALE + dx)) * 4;
              canvas.set(px, o);
            }
          }
        }
      }
      x0 += img.width * SCALE + GAP;
    }
    y0 += rowH(row);
  }
  fs.mkdirSync(path.dirname(OUT_CONTACT), { recursive: true });
  fs.writeFileSync(OUT_CONTACT, encodePng(width, height, canvas));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
