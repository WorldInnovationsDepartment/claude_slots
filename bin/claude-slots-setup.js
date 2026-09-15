#!/usr/bin/env node
// Claude Slots — Tier 2 setup/teardown.
//
// Idempotent installer for the statusLine fallback described in
// docs/ARCHITECTURE.md §5: points `statusLine` at
// bin/claude-slots-statusline.js, replaces `spinnerVerbs` with slot-themed
// phrases, and turns off `spinnerTipsEnabled` (the tip line would otherwise
// fight for the same row). The user's previous values are saved once, on
// first --apply, into a small config file, and `--restore` puts them back
// and deletes that file.
//
// Safety: this script NEVER guesses at ~/.claude/settings.json's shape
// beyond three keys (statusLine, spinnerVerbs, spinnerTipsEnabled) — every
// other key round-trips through JSON.parse/JSON.stringify untouched. It
// always backs up the settings file before writing to it on --apply or
// --restore, and defaults to --dry-run (prints the diff, changes nothing)
// unless --apply or --restore is passed explicitly.
//
// Usage:
//   node claude-slots-setup.js                 # dry run (default), prints diff
//   node claude-slots-setup.js --apply         # install
//   node claude-slots-setup.js --restore       # uninstall, restore previous
//   node claude-slots-setup.js --apply --no-statusline   # skip the statusLine part
//   node claude-slots-setup.js --apply --no-verbs        # skip the spinnerVerbs part
//   node claude-slots-setup.js --settings-path <path>    # operate on a different file
//                                                          (tests must always pass this)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const SLOT_VERBS = [
  'Pulling the lever',
  'Spinning the reels',
  'Reels whirring',
  'Chasing sevens',
  'Feeling lucky',
  'Lining up the payline',
  'Cranking the one-armed bandit',
  'Rolling the RNG',
  'Watching for jackpots',
  'Banking the credits',
];

function defaultSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function defaultPluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'claude-slots');
}

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    restore: false,
    noStatusline: false,
    noVerbs: false,
    settingsPath: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--restore') args.restore = true;
    else if (a === '--no-statusline') args.noStatusline = true;
    else if (a === '--no-verbs') args.noVerbs = true;
    else if (a === '--settings-path') args.settingsPath = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      process.stderr.write(`claude-slots-setup: unknown argument ${JSON.stringify(a)} (ignored)\n`);
    }
  }
  if (args.restore && args.apply) {
    throw new Error('--apply and --restore are mutually exclusive');
  }
  // Default mode, per the spec: dry-run unless --apply or --restore was given.
  if (!args.apply && !args.restore) args.dryRun = true;
  return args;
}

function printHelp() {
  process.stdout.write(`claude-slots-setup.js — install/uninstall the Claude Slots Tier 2 statusline

  --dry-run            print the diff, change nothing (default)
  --apply              write the changes to settings.json
  --restore            put back the previous statusLine/spinnerVerbs/spinnerTipsEnabled
                        and remove the saved config
  --no-statusline      when applying, do not touch statusLine
  --no-verbs           when applying, do not touch spinnerVerbs
  --settings-path P    operate on P instead of ~/.claude/settings.json
  --help               show this message
`);
}

/**
 * Reads and parses a JSON file, never throwing — a hand-edited or
 * partially-written settings.json/config.json (e.g. left over from a
 * previous crash) must never crash this script, even in --dry-run, which
 * reads both files before writing anything. `parseError` is set (and
 * `value` is `{}`) when the file exists but isn't valid JSON; callers must
 * check it and stop rather than silently operating on/overwriting a file
 * they couldn't actually read.
 */
function readJsonFile(p) {
  if (!fs.existsSync(p)) return { value: {}, existed: false, parseError: null };
  const raw = fs.readFileSync(p, 'utf8');
  if (raw.trim().length === 0) return { value: {}, existed: true, parseError: null };
  try {
    return { value: JSON.parse(raw), existed: true, parseError: null };
  } catch (err) {
    return { value: {}, existed: true, parseError: err.message };
  }
}

function writeJsonFile(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function backupFile(p) {
  if (!fs.existsSync(p)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${p}.claude-slots.bak-${ts}`;
  fs.copyFileSync(p, backupPath);
  return backupPath;
}

function statuslineTarget() {
  const scriptPath = path.join(PLUGIN_ROOT, 'bin', 'claude-slots-statusline.js');
  return {
    type: 'command',
    command: `node "${scriptPath}"`,
    refreshInterval: 1,
  };
}

function verbsTarget() {
  return { mode: 'replace', verbs: SLOT_VERBS };
}

function tier1Status() {
  const enabled =
    process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1' ||
    process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === 'true';
  if (enabled) {
    return 'Tier 1 (function hooks) is ACTIVE in this environment — the real animated spinner replacement is in effect; this statusLine setup is your Tier 2 fallback for when it is not.';
  }
  return (
    'Tier 1 (function hooks) is NOT enabled here — CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is unset. ' +
    'To get the full animated spinner replacement, add this to your shell profile ' +
    '(~/.zshrc or ~/.bashrc) and restart Claude Code:\n' +
    '    export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1\n' +
    'Until then, the Tier 2 statusLine machine (1 fps) this command installs is what you get.'
  );
}

function diffLine(label, before, after) {
  const b = before === undefined ? '(absent)' : JSON.stringify(before);
  const a = after === undefined ? '(absent)' : JSON.stringify(after);
  if (b === a) return `  ${label}: unchanged (${b})`;
  return `  ${label}:\n    - ${b}\n    + ${a}`;
}

function runApplyOrDryRun(args) {
  const settingsPath = args.settingsPath || defaultSettingsPath();
  const configDir = defaultPluginDataDir();
  const configPath = path.join(configDir, 'config.json');

  const { value: settings, existed: settingsExisted, parseError: settingsParseError } = readJsonFile(settingsPath);
  if (settingsParseError) {
    process.stderr.write(`claude-slots-setup: ${settingsPath} contains invalid JSON (${settingsParseError}) — refusing to touch it. Fix or remove the file and try again.\n`);
    process.exitCode = 1;
    return;
  }
  const configResult = readJsonFile(configPath);
  if (configResult.parseError) {
    process.stderr.write(`claude-slots-setup: ${configPath} contains invalid JSON (${configResult.parseError}) — refusing to touch it. Fix or remove the file and try again.\n`);
    process.exitCode = 1;
    return;
  }
  const alreadyApplied = configResult.existed;
  const savedConfig = configResult.value;

  // The "original" values are: whatever is saved in config.json if we've
  // already applied once (so a re-run never clobbers the true original with
  // our own slot values); otherwise whatever settings.json has right now.
  const originalStatusLine = alreadyApplied ? savedConfig.statusLine : settings.statusLine;
  const originalVerbs = alreadyApplied ? savedConfig.spinnerVerbs : settings.spinnerVerbs;
  const originalTips = alreadyApplied ? savedConfig.spinnerTipsEnabled : settings.spinnerTipsEnabled;

  const nextSettings = { ...settings };
  if (!args.noStatusline) nextSettings.statusLine = statuslineTarget();
  if (!args.noVerbs) nextSettings.spinnerVerbs = verbsTarget();
  nextSettings.spinnerTipsEnabled = false;

  const lines = [];
  lines.push(`Settings file: ${settingsPath}${settingsExisted ? '' : ' (does not exist yet — will be created)'}`);
  lines.push(`Plugin data / saved config: ${configPath}${alreadyApplied ? ' (already applied once — original values already saved there)' : ' (not yet applied)'}`);
  lines.push('');
  lines.push(args.dryRun ? 'DRY RUN — no files will be written. Pass --apply to install.' : 'Applying:');
  lines.push(diffLine('statusLine', settings.statusLine, args.noStatusline ? settings.statusLine : nextSettings.statusLine));
  lines.push(diffLine('spinnerVerbs', settings.spinnerVerbs, args.noVerbs ? settings.spinnerVerbs : nextSettings.spinnerVerbs));
  lines.push(diffLine('spinnerTipsEnabled', settings.spinnerTipsEnabled, nextSettings.spinnerTipsEnabled));
  lines.push('');
  lines.push(tier1Status());

  process.stdout.write(lines.join('\n') + '\n');

  if (args.dryRun) return;

  // --apply from here on.
  const backupPath = backupFile(settingsPath);

  if (!alreadyApplied) {
    writeJsonFile(configPath, {
      statusLine: originalStatusLine ?? null,
      spinnerVerbs: originalVerbs ?? null,
      spinnerTipsEnabled: originalTips ?? null,
      settingsPath,
      appliedAt: new Date().toISOString(),
    });
  }

  writeJsonFile(settingsPath, nextSettings);

  process.stdout.write('\n');
  if (backupPath) process.stdout.write(`Backed up previous settings to: ${backupPath}\n`);
  else process.stdout.write('No pre-existing settings file to back up.\n');
  process.stdout.write(`Wrote: ${settingsPath}\n`);
  process.stdout.write(`Saved original statusLine/spinnerVerbs/spinnerTipsEnabled to: ${configPath}\n`);
  process.stdout.write('Run /claude-slots:teardown (or --restore) any time to put everything back.\n');
}

function runRestore(args) {
  const settingsPath = args.settingsPath || defaultSettingsPath();
  const configDir = defaultPluginDataDir();
  const configPath = path.join(configDir, 'config.json');

  const { value: savedConfig, existed: configExisted, parseError: configParseError } = readJsonFile(configPath);
  if (configParseError) {
    process.stderr.write(`claude-slots-setup: ${configPath} contains invalid JSON (${configParseError}) — refusing to touch it. Fix or remove the file and try again.\n`);
    process.exitCode = 1;
    return;
  }
  if (!configExisted) {
    process.stdout.write(
      `Nothing to restore: ${configPath} does not exist (setup was never applied, or was already restored).\n`
    );
    return;
  }

  const { value: settings, existed: settingsExisted, parseError: settingsParseError } = readJsonFile(settingsPath);
  if (settingsParseError) {
    process.stderr.write(`claude-slots-setup: ${settingsPath} contains invalid JSON (${settingsParseError}) — refusing to touch it. Fix or remove the file and try again.\n`);
    process.exitCode = 1;
    return;
  }
  if (!settingsExisted) {
    process.stdout.write(`${settingsPath} does not exist — nothing to restore into. Removing saved config anyway.\n`);
    fs.rmSync(configPath, { force: true });
    return;
  }

  const backupPath = backupFile(settingsPath);

  const nextSettings = { ...settings };
  for (const key of ['statusLine', 'spinnerVerbs', 'spinnerTipsEnabled']) {
    const saved = savedConfig[key];
    if (saved === null || saved === undefined) {
      delete nextSettings[key];
    } else {
      nextSettings[key] = saved;
    }
  }

  writeJsonFile(settingsPath, nextSettings);
  fs.rmSync(configPath, { force: true });

  process.stdout.write(`Backed up settings to: ${backupPath}\n`);
  process.stdout.write(`Restored statusLine/spinnerVerbs/spinnerTipsEnabled in: ${settingsPath}\n`);
  process.stdout.write(`Removed saved config: ${configPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.restore) runRestore(args);
  else runApplyOrDryRun(args);
}

main();
