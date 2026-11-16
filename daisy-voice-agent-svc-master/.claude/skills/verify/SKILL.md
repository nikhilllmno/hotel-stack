---
name: verify
description: Validate changes before committing — build, lint, and test in sequence.
---

Run all verification steps before committing.

Arguments:
- $ARGUMENTS: Optional test pattern to narrow the test step

Instructions:

Run these steps **sequentially** from `websocket-server/`. Stop immediately on the first failure.

1. `npm run build` — compile TypeScript (stop if fails)
2. `npm run lint` — lint changed files (stop if fails)
3. Use `/test` to run unit tests (stop if fails)
   - If $ARGUMENTS is provided, pass it as the test pattern

If all pass, show a success summary.
On failure, stop immediately and report:
- Which step failed
- The error output
- Suggested fix

Hard Rules:
1. **Always run from `websocket-server/`** — all commands expect this cwd.
2. **Stop on first failure** — don't continue to later steps if an earlier one fails.
3. **Don't auto-fix lint errors** — report them and let the user decide.
