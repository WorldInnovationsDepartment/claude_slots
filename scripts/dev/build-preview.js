#!/usr/bin/env node
// Claude Slots — browser preview builder (scripts/dev/build-preview.js)
//
// Concatenates lib/*.js (untouched on disk) into ONE inline, dependency-free
// <script type="module"> block, rewriting every relative `import`/`export`
// statement into a tiny hand-rolled module table (`__modules['./x.js']`)
// instead of leaving real ESM specifiers behind — a `file://`-opened HTML
// page (and this artifact's sandboxed origin) cannot resolve bare relative
// module imports reliably, so the whole point of this script is that NO
// `import`/`export` keyword survives in the emitted bundle.
//
// lib/ is never modified: this script only reads it and writes the built
// output into docs/preview.html (via the HTML_TEMPLATE below, which owns
// the actual UI/controls markup) or, with --check, just prints the bundle
// to stdout for inspection.
//
// Usage:
//   node scripts/dev/build-preview.js            # builds docs/preview.html
//   node scripts/dev/build-preview.js --bundle-only   # prints just the JS bundle to stdout

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LIB = path.join(ROOT, 'lib');
const TEMPLATE_PATH = path.join(__dirname, 'preview-template.html');
const OUT_PATH = path.join(ROOT, 'docs', 'preview.html');

// ---------------------------------------------------------------------------
// A tiny, purpose-built ESM -> flat-scope transformer. Not a general bundler
// — it only needs to handle the exact import/export shapes lib/*.js actually
// uses (named imports/exports, `as` aliasing, bare `export { a, b };`, and
// `export { a, b } from './x.js';` re-exports). Every regex below is
// verified against the literal lines present in lib/ (see the build's own
// self-check at the bottom of this file).
// ---------------------------------------------------------------------------

function parseSpecifiers(raw) {
  // "a, b as c, d" -> [{imported:'a',local:'a'}, {imported:'b',local:'c'}, {imported:'d',local:'d'}]
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const m = spec.match(/^(\S+)\s+as\s+(\S+)$/);
      if (m) return { imported: m[1], local: m[2] };
      return { imported: spec, local: spec };
    });
}

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*'(\.\/[\w.-]+\.js)';?\s*\n?/g;
const EXPORT_FROM_RE = /export\s*\{([^}]*)\}\s*from\s*'(\.\/[\w.-]+\.js)';?\s*\n?/g;
const EXPORT_BARE_RE = /export\s*\{([^}]*)\}(?!\s*from)\s*;?\s*\n?/g;
const EXPORT_DECL_RE = /export\s+(async\s+function|function|const|let|class)\s+([A-Za-z0-9_$]+)/g;

/**
 * Transform one file's source, given the set of `./x.js` specifiers that are
 * "internal" to the current bundle unit (already in the same scope, so their
 * import/re-export lines are dropped rather than turned into a
 * `__modules[...]` lookup) and a shared `externalImports` map this call
 * appends to (from -> Map<local, imported>) for the caller to emit ONE
 * merged destructure per external module (avoids `const { x }` being
 * declared twice in one scope when two files in the same unit both import
 * the same name from the same external module).
 */
function transformSource(src, { internal, externalImports, exportNames }) {
  let body = src;

  // export function/const/let/class NAME  ->  function/const/let/class NAME (record export)
  body = body.replace(EXPORT_DECL_RE, (m, kind, name) => {
    exportNames.add(name);
    return `${kind} ${name}`;
  });

  // export { a, b as c } from './x.js';  (re-export, with or without `from` staying internal)
  body = body.replace(EXPORT_FROM_RE, (m, raw, from) => {
    const specs = parseSpecifiers(raw);
    specs.forEach((s) => exportNames.add(s.local));
    if (!internal.has(from)) {
      let map = externalImports.get(from);
      if (!map) externalImports.set(from, (map = new Map()));
      specs.forEach((s) => map.set(s.local, s.imported));
    }
    return ''; // binding is emitted either by the merged external destructure, or (internal) already in scope
  });

  // export { a, b as c };  (bare local re-export/alias, no `from`)
  body = body.replace(EXPORT_BARE_RE, (m, raw) => {
    const specs = parseSpecifiers(raw);
    let extra = '';
    specs.forEach((s) => {
      exportNames.add(s.local);
      if (s.local !== s.imported) extra += `const ${s.local} = ${s.imported};\n`;
    });
    return extra;
  });

  // import { a, b as c } from './x.js';
  body = body.replace(IMPORT_RE, (m, raw, from) => {
    const specs = parseSpecifiers(raw);
    if (internal.has(from)) return ''; // already bound in this unit's shared scope
    let map = externalImports.get(from);
    if (!map) externalImports.set(from, (map = new Map()));
    specs.forEach((s) => map.set(s.local, s.imported));
    return '';
  });

  return body;
}

/** Build one `__modules['./key.js'] = (function(){ ... })();` entry from one or more lib/ files sharing a scope. */
function buildUnit(key, files) {
  const internal = new Set(files.map((f) => `./${f}`));
  const externalImports = new Map(); // from -> Map<local, imported>
  const exportNames = new Set();
  const bodies = files.map((f) => transformSource(readLib(f), { internal, externalImports, exportNames }));

  const importLines = [...externalImports.entries()].map(([from, map]) => {
    const destructure = [...map.entries()].map(([local, imported]) => (local === imported ? local : `${imported}: ${local}`)).join(', ');
    return `  const { ${destructure} } = __modules[${JSON.stringify(from)}];`;
  });

  const indented = bodies.map((b) => b.replace(/^/gm, '  ')).join('\n\n');
  const exportsObj = [...exportNames].join(', ');

  return `__modules[${JSON.stringify(key)}] = (function () {\n  'use strict';\n${importLines.join('\n')}\n\n${indented}\n\n  return { ${exportsObj} };\n})();`;
}

function readLib(name) {
  return readFileSync(path.join(LIB, name), 'utf8');
}

// Dependency order matters only for readability here — every unit resolves
// its cross-unit references through `__modules[...]`, which is populated in
// this exact array order (a plain DAG; art.js+art-storyboards.js are combined
// into one unit below specifically because they import each other, a real
// circular ESM dependency that a flat `__modules[...]` table can't otherwise
// satisfy without one of the two lookups happening before the other unit's
// IIFE has run).
const UNITS = [
  { key: './width.js', files: ['width.js'] },
  { key: './frame.js', files: ['frame.js'] },
  { key: './symbols.js', files: ['symbols.js'] },
  { key: './rng.js', files: ['rng.js'] },
  { key: './economy.js', files: ['economy.js'] },
  { key: './art.js', files: ['art.js', 'art-storyboards.js'] },
  { key: './machine.js', files: ['machine.js'] },
  { key: './render-tree.js', files: ['render-tree.js'] },
  { key: './render-ansi.js', files: ['render-ansi.js'] },
];

function buildBundle() {
  const parts = ['const __modules = Object.create(null);', ''];
  for (const unit of UNITS) parts.push(buildUnit(unit.key, unit.files), '');
  parts.push(
    "// Public surface for the preview page's own script — mirrors the CORE ENGINE PUBLIC API doc.",
    'const CS = {',
    "  width: __modules['./width.js'],",
    "  frame: __modules['./frame.js'],",
    "  symbols: __modules['./symbols.js'],",
    "  rng: __modules['./rng.js'],",
    "  economy: __modules['./economy.js'],",
    "  art: __modules['./art.js'],",
    "  machine: __modules['./machine.js'],",
    "  renderTree: __modules['./render-tree.js'],",
    "  renderAnsi: __modules['./render-ansi.js'],",
    '};',
    'globalThis.CS = CS;'
  );
  const bundle = parts.join('\n');

  // Self-check: no import/export syntax may survive (the whole point of this
  // build). Scan for the actual keywords rather than trusting the regexes
  // above blindly — this is the "no unresolved import statements" gate the
  // task asked to verify.
  const stray = bundle.match(/\b(import|export)\b\s*[{*'"]|\bexport\s+(default|function|const|let|class)\b/g);
  if (stray) {
    throw new Error(`build-preview: bundle still contains ESM import/export syntax: ${JSON.stringify(stray.slice(0, 10))}`);
  }
  return bundle;
}

function main() {
  const args = process.argv.slice(2);
  const bundle = buildBundle();

  if (args.includes('--bundle-only')) {
    process.stdout.write(bundle + '\n');
    return;
  }

  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(`build-preview: missing template at ${TEMPLATE_PATH}`);
  }
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const marker = '/*__CLAUDE_SLOTS_LIB_BUNDLE__*/';
  if (!template.includes(marker)) {
    throw new Error(`build-preview: template is missing the ${marker} injection marker`);
  }
  const out = template.replace(marker, bundle);
  writeFileSync(OUT_PATH, out, 'utf8');
  process.stdout.write(`build-preview: wrote ${OUT_PATH} (${out.length} bytes, bundle ${bundle.length} bytes)\n`);
}

main();
