#!/usr/bin/env node
// Claude Slots — read-only stats reporter.
//
// Prints whatever Tier 1 (the function-hooks module's `$.store`) and/or
// Tier 2 (the per-session state files) have recorded. Never writes
// anything. Safe to run with no data at all — prints a friendly "pull the
// lever first" message instead of guessing numbers.
//
// Tier 1 storage: `$.store` persists to a JSON file under
//   ~/.claude/plugins/store/<plugin-name>_<load-kind>-<hash>.json
// (observed convention, e.g. `fh-spike_inline-faecb682432f.json`) — one file
// per distinct way the plugin was loaded (--plugin-dir vs. a marketplace
// install), so this script globs every `claude-slots*.json` file there and
// reports each one, since a user may have used more than one.
//
// Tier 2 storage: one file per session under
//   ${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json
//
// This script itself runs as a plain Bash-tool command (commands/stats.md),
// not a plugin hook — verified live (see bin/claude-slots-statusline.js's
// own header for the fuller story) that CLAUDE_PLUGIN_DATA is only ever set
// for hook commands, never for an ordinary Bash tool invocation. So this
// falls back the same way the statusline does: read the pointer file
// bin/claude-slots-hook.js maintains at
// `<pluginRoot>/.claude-slots-runtime/plugin-data-dir.txt` before giving up
// and reporting "no data yet" — otherwise this command would (and, before
// this fix, reproducibly did) claim there was no Tier 2 data at all while a
// real session file sat one directory over.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function resolvePluginDataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  try {
    const pointerPath = path.join(PLUGIN_ROOT, '.claude-slots-runtime', 'plugin-data-dir.txt');
    const fromPointer = fs.readFileSync(pointerPath, 'utf8').trim();
    if (fromPointer) return fromPointer;
  } catch {
    // bin/claude-slots-hook.js hasn't run yet — fall through to the default
  }
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'claude-slots');
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listFiles(dir, predicate) {
  try {
    return fs
      .readdirSync(dir)
      .filter(predicate)
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function fmtCredits(v) {
  return typeof v === 'number' ? String(v) : JSON.stringify(v);
}

function printTier1() {
  const storeDir = path.join(os.homedir(), '.claude', 'plugins', 'store');
  const files = listFiles(storeDir, (f) => f.startsWith('claude-slots') && f.endsWith('.json'));

  if (files.length === 0) {
    console.log('Tier 1 store: no data yet (no ~/.claude/plugins/store/claude-slots*.json file found).');
    return false;
  }

  console.log(`Tier 1 store (${files.length} file${files.length === 1 ? '' : 's'}):`);
  for (const f of files) {
    const data = safeReadJson(f);
    console.log(`  ${f}`);
    if (!data || typeof data !== 'object') {
      console.log('    (unreadable or empty)');
      continue;
    }
    if ('credits' in data) console.log(`    credits: ${fmtCredits(data.credits)}`);
    if ('stats' in data) console.log(`    stats: ${JSON.stringify(data.stats)}`);
    const known = new Set(['credits', 'stats']);
    for (const [k, v] of Object.entries(data)) {
      if (known.has(k)) continue;
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  }
  return true;
}

function printTier2() {
  const dataDir = resolvePluginDataDir();
  const sessionsDir = path.join(dataDir, 'sessions');
  const files = listFiles(sessionsDir, (f) => f.endsWith('.json'));

  if (files.length === 0) {
    console.log(`Tier 2 sessions: no data yet (no files under ${sessionsDir}).`);
    return false;
  }

  console.log(`Tier 2 sessions (${files.length} file${files.length === 1 ? '' : 's'} under ${sessionsDir}):`);
  let totalSpins = 0;
  let totalJackpots = 0;
  for (const f of files) {
    const data = safeReadJson(f);
    if (!data || typeof data !== 'object') continue;
    const sessionId = path.basename(f, '.json');
    const spins = data.stats?.spins ?? data.spins;
    const jackpots = data.stats?.jackpots ?? data.jackpots;
    if (typeof spins === 'number') totalSpins += spins;
    if (typeof jackpots === 'number') totalJackpots += jackpots;
    console.log(`  ${sessionId}: credits=${fmtCredits(data.credits)} ${JSON.stringify(data.stats ?? {})}`);
  }
  console.log(`  --- totals across sessions: spins=${totalSpins} jackpots=${totalJackpots} ---`);
  return true;
}

function main() {
  console.log('Claude Slots — stats\n');
  const hadTier1 = printTier1();
  console.log('');
  const hadTier2 = printTier2();

  if (!hadTier1 && !hadTier2) {
    console.log('\nNo data yet — pull the lever first (submit a prompt with the plugin active).');
  }
}

main();
