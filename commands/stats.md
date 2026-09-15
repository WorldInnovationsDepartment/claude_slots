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
- It reports from whichever tier has data: Tier 1's `$.store`-backed file
  under `~/.claude/plugins/store/`, and/or Tier 2's per-session state files
  under `${CLAUDE_PLUGIN_DATA}/sessions/`. If both exist, show both; if
  neither exists yet, relay the script's "no data yet — pull the lever
  first" message rather than inventing numbers.
