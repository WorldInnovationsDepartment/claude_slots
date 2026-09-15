// Claude Slots — ANSI renderer (lib/render-ansi.js), Tier 2 (statusLine)
//
// Pure ESM, zero dependencies. Frame -> a raw ANSI string: `\x1b[38;2;r;g;bm`
// truecolor (or a 256-color `\x1b[38;5;Nm` fallback via nearest xterm index
// when the terminal lacks truecolor), one reset per styled span, lines
// joined with '\n'. No leading/trailing whitespace reliance — every line is
// bounded by the chassis's own border glyphs (or, for COMPACT, padded to a
// fixed column budget by art.js), so a renderer/terminal that trims
// whitespace never breaks alignment.
//
// docs/ARCHITECTURE.md's live-measured facts note that Tier 1's `dimColor`
// renders as a flat gray (~#999999), not the SGR "faint" attribute — this
// renderer matches that for visual parity between tiers: a dim span's
// foreground is forced to that gray rather than emitting SGR 2.

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM_GRAY = '#999999';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Nearest xterm-256 palette index for an RGB triple (6x6x6 cube + grayscale ramp). */
function rgbToAnsi256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const toCube = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

function colorCodes(prefixTrue, prefix256, hex, truecolor) {
  const [r, g, b] = hexToRgb(hex);
  return truecolor ? [...prefixTrue, r, g, b] : [...prefix256, rgbToAnsi256(r, g, b)];
}

/**
 * @param {import('./frame.js').Frame} frame
 * @param {{truecolor?: boolean}} [opts] default true; pass false to use the 256-color fallback
 * @returns {string}
 */
export function renderAnsi(frame, opts = {}) {
  const truecolor = opts.truecolor !== false;
  const lines = frame.lines.map((lineSpans) => {
    let out = '';
    for (const s of lineSpans) {
      const codes = [];
      if (s.bold) codes.push(1);
      if (s.inverse) codes.push(7);
      const fgHex = s.dim ? DIM_GRAY : s.color;
      if (fgHex) codes.push(...colorCodes([38, 2], [38, 5], fgHex, truecolor));
      if (s.bg) codes.push(...colorCodes([48, 2], [48, 5], s.bg, truecolor));
      out += codes.length ? `${ESC}${codes.join(';')}m${s.text}${RESET}` : s.text;
    }
    return out;
  });
  return lines.join('\n');
}
