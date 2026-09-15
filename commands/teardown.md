---
description: Undo Claude Slots' Tier 2 setup and restore your previous statusLine/spinnerVerbs
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-setup.js" *)
argument-hint: "[--settings-path <path>]"
---

Run this exact command and relay its full output to the user verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-setup.js" --restore $ARGUMENTS
```

Notes for you (the assistant), not for the script:

- This puts back whatever `statusLine` / `spinnerVerbs` / `spinnerTipsEnabled`
  the user had before `/claude-slots:setup --apply` ran (saved in
  `${CLAUDE_PLUGIN_DATA}/config.json`), then removes that saved config.
- If the script reports there was nothing to restore (setup was never
  applied), just relay that — do not attempt to "fix" settings.json by hand.
- Never edit `~/.claude/settings.json` yourself; only this script does.
