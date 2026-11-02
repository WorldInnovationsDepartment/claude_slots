---
description: Show Claude Slots credits, spins, and win stats
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-stats.js" *)
argument-hint: ""
---

Run this exact command and relay its full output to the user verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-stats.js"
```

Notes for you (the assistant), not for the script:

- This is read-only — it never modifies credits, stats, or settings.
- It reads the mod's `$.store` file under `~/.claude/plugins/store/`
  (key `slots.economy`). If nothing exists yet, relay the script's
  "no data yet — pull the trigger first" message rather than inventing numbers.
