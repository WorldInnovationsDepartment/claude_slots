---
description: Play a one-off Claude Slots spin animation in the transcript, no turn required
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/demo.js" *)
argument-hint: "[life|client|feature|lose|aborted|error|spinning]"
---

Run this exact command and relay its full output to the user verbatim — it is
already a complete, self-contained animation/result rendered as plain text
(ANSI), not something to summarize or re-describe:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/demo.js" $ARGUMENTS
```

Notes for you (the assistant), not for the script:

- This never touches real credits/stats — it is a standalone render using the
  same `lib/` engine and sprite sheet, seeded independently, purely for
  previewing art without needing a live turn.
- `$ARGUMENTS` may name an outcome (`life`, `client`, `feature`, `lose`,
  `aborted`, `error`) to force, or a phase to loop (`spinning`, `win-life`,
  `win-client`, `win-feature`, `lose`, `abort`, `error`); with no arguments
  the script plays a random spin. `--help` lists the flags.
- Print the script's stdout exactly as received (inside a fenced code block
  if the surrounding chat strips ANSI) — do not re-render or re-describe the
  frames yourself.
