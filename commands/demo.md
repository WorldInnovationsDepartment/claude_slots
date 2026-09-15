---
description: Play a one-off Claude Slots spin animation in the transcript, no turn required
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-demo.js" *)
argument-hint: "[outcome] [size]"
---

Run this exact command and relay its full output to the user verbatim — it is
already a complete, self-contained animation/result rendered as plain text
(ANSI), not something to summarize or re-describe:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/claude-slots-demo.js" $ARGUMENTS
```

Notes for you (the assistant), not for the script:

- This never touches real credits/stats — it is a standalone render using the
  same `lib/` engine, seeded independently, purely for previewing art without
  needing a live turn.
- `$ARGUMENTS` may name an outcome class (`jackpot`, `medallion`, `triple`,
  `double`, `near-miss`, `lose`) to force for the demo, and/or a size
  (`compact`, `standard`, `grand`); with no arguments the script picks a
  reasonable default and prints usage for the rest in `--help`.
- Print the script's stdout exactly as received (inside a fenced code block
  if the surrounding chat strips ANSI) — do not re-render or re-describe the
  frames yourself.
