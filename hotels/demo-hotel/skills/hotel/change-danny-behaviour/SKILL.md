---
name: change-danny-behaviour
description: "Change how Danny behaves on calls or texts"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Danny's instructions (prompts)

Owner says: "Danny should always offer the booking link when someone wants to book online", "don't ask for the email",
"be more brief by text".

1. `agent_overview` -> `instructions` lists each file with its sections (calls: prompts/voice/*, texts: prompts/text/*).
   Rules that must always hold are in policies/ (`rule_files`).
2. Pick the section that owns the situation (e.g. new reservation steps) and change only that. Keep the file's
   style: numbered steps, bold step names, tool names in backticks.
3. Calls and texts are separate files; ask yourself whether the owner meant both, and change both if so.
4. Add or update a test scenario for the new behaviour in the same proposal when possible (add-test-scenario).
5. `draft_change(request, paths)` works well here: give the plain request and the instruction file paths.

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
