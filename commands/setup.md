---
description: Install Claude Slots' Tier 2 statusline fallback (backs up your settings first)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-setup.js" *)
argument-hint: "[--apply] [--dry-run] [--no-statusline] [--no-verbs] [--settings-path <path>]"
---

Run this exact command and relay its full output to the user verbatim (it already
explains what it changed, what it backed up, and whether Tier 1 function hooks
are active):

```
node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-setup.js" $ARGUMENTS
```

Notes for you (the assistant), not for the script:

- With no flags the script defaults to `--dry-run` and only prints the diff —
  it makes no changes unless the user (or `$ARGUMENTS`) passes `--apply`. If
  the user just typed `/claude-slots:setup` with no arguments, run it as-is,
  show them the dry-run diff, and ask whether to re-run with `--apply`.
- If `$ARGUMENTS` already contains `--apply`, run it once — do not also run a
  bare dry-run first.
- Never edit `~/.claude/settings.json` yourself; only this script touches it,
  and only on `--apply`.
- The script's own output tells the user how to enable Tier 1
  (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`) if it isn't already — just relay
  that line, don't re-derive it.
