// grid.ts — the pixel model every machine layer is authored in.
//
// A Grid is rows of palette indices (see ../palette.ts); TRANSPARENT (-1)
// marks a pixel the layer does not paint. Everything here is pure data and
// pure functions so the same code runs in Remotion (sprite + video) and can
// be unit-tested without a browser.

export const TRANSPARENT = -1;

export type Grid = number[][];

export function makeGrid(w: number, h: number, fill = TRANSPARENT): Grid {
  const g: Grid = [];
  for (let y = 0; y < h; y++) g.push(new Array<number>(w).fill(fill));
  return g;
}

export function gridWidth(g: Grid): number {
  return g.length ? g[0].length : 0;
}

export function gridHeight(g: Grid): number {
  return g.length;
}

/** Paint one pixel if it is inside the grid (out-of-range writes are ignored). */
export function put(g: Grid, x: number, y: number, c: number): void {
  if (y < 0 || y >= g.length) return;
  const row = g[y];
  if (x < 0 || x >= row.length) return;
  row[x] = c;
}

/** Filled rectangle. */
export function rect(g: Grid, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(g, xx, yy, c);
}

/** Hollow rectangle (1 px border). */
export function frame(g: Grid, x: number, y: number, w: number, h: number, c: number): void {
  rect(g, x, y, w, 1, c);
  rect(g, x, y + h - 1, w, 1, c);
  rect(g, x, y, 1, h, c);
  rect(g, x + w - 1, y, 1, h, c);
}

/** Stamp `src` onto `dst` at (x, y); transparent source pixels leave dst alone. */
export function blit(dst: Grid, src: Grid, x: number, y: number): void {
  for (let sy = 0; sy < src.length; sy++) {
    const row = src[sy];
    for (let sx = 0; sx < row.length; sx++) {
      const c = row[sx];
      if (c !== TRANSPARENT) put(dst, x + sx, y + sy, c);
    }
  }
}

/** Copy a w×h window of `src` starting at (x, y) (rows wrap vertically, so a scrolling strip is seamless). */
export function window(src: Grid, x: number, y: number, w: number, h: number): Grid {
  const H = src.length;
  const out = makeGrid(w, h);
  for (let yy = 0; yy < h; yy++) {
    const srcRow = src[(((y + yy) % H) + H) % H];
    for (let xx = 0; xx < w; xx++) out[yy][xx] = srcRow[x + xx] ?? TRANSPARENT;
  }
  return out;
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.slice());
}

/**
 * Deterministic 32-bit hash of a few integers → [0, 1). No Math.random
 * anywhere in the art: the sprite build must be byte-identical run to run.
 */
export function hash01(...parts: number[]): number {
  let h = 0x9e3779b9 >>> 0;
  for (const p of parts) {
    h ^= (p | 0) + 0x7f4a7c15;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Parse an ASCII pixel map into a Grid using `legend` (char → palette index); '.' is transparent unless mapped. */
export function parseMap(rows: readonly string[], legend: Readonly<Record<string, number>>): Grid {
  const w = rows[0].length;
  const g = makeGrid(w, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`parseMap: row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const c = legend[ch];
      g[y][x] = c === undefined ? TRANSPARENT : c;
    }
  });
  return g;
}
