#!/usr/bin/env node
// Claude Slots — read-only stats reporter (`/slots:stats`).
//
// Prints what the mod has persisted through `$.store`. Never writes anything.
// Safe to run with no data at all — prints a "pull the trigger first" message
// instead of guessing numbers.
//
// `$.store` persists to a JSON file under
//   ~/.claude/plugins/store/<plugin-name>_<load-kind>-<hash>.json
// one file per distinct way the plugin was loaded (--plugin-dir vs. a
// marketplace install), so this globs every `slots*.json` there
// and reports each. Inside, the economy lives under the key
// `slots.economy` (lib/mod-helpers.js STORE_KEY).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { STORE_KEY } from '../lib/mod-helpers.js';

const STORE_DIR = process.env.SLOTS_STORE_DIR || path.join(os.homedir(), '.claude', 'plugins', 'store');

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function listStoreFiles() {
  try {
    return fs
      .readdirSync(STORE_DIR)
      .filter((f) => f.startsWith('slots') && f.endsWith('.json'))
      .map((f) => path.join(STORE_DIR, f));
  } catch {
    return [];
  }
}

function report(economy) {
  const stats = economy.stats || {};
  const wins = stats.winsByClass || {};
  console.log(`    balance:  ${economy.credits}`);
  console.log(`    spins:    ${stats.spins ?? 0}`);
  console.log(`    wins:     LIFE ${wins.LIFE ?? 0} · CLIENT ${wins.CLIENT ?? 0} · FEATURE ${wins.FEATURE ?? 0}`);
  console.log(`    no match: ${wins.LOSE ?? 0}   refunded: ${(wins.ABORTED ?? 0) + (wins.ERROR ?? 0)}`);
  console.log(`    streak:   ${stats.streak ?? 0} (best ${stats.bestStreak ?? 0})   last win: ${economy.lastWin ?? 0}`);
  if (Array.isArray(stats.recent) && stats.recent.length) {
    console.log(`    recent:   ${stats.recent.map((r) => (r.symbols ? `${r.outcomeClass} [${r.symbols.join(' ')}]` : r.outcomeClass)).join('  |  ')}`);
  }
}

function main() {
  console.log('Claude Slots — stats\n');
  const files = listStoreFiles();
  let found = 0;
  for (const f of files) {
    const data = safeReadJson(f);
    const economy = data && typeof data === 'object' ? data[STORE_KEY] : null;
    if (!economy || typeof economy !== 'object') continue;
    found++;
    console.log(`  ${f}`);
    report(economy);
    console.log('');
  }
  if (!found) {
    console.log(`No data yet — pull the trigger first (submit a prompt with the plugin active).`);
    console.log(`Looked for ${path.join(STORE_DIR, 'slots*.json')} with key ${JSON.stringify(STORE_KEY)}.`);
  }
}

main();
