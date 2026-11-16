---
name: add-test-scenario
description: "Add a test conversation that proves Danny handles something"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Test scenarios (evals) for Danny

Owner says: "make sure Danny handles X", "add a test for guests who ...", or after any behaviour change.

1. `agent_overview` -> `test_scenarios` lists existing ones. Calls: `hotels/contigo-ranch/evals/voice.yaml`;
   texts: `evals/text.yaml`. Read the header comment of the file first.
2. Format:
   ```
   - name: short description
     say: ["what the guest says", "next turn"]     # one entry per turn
     tool: {name: <tool>, arguments: {<partial args>}}   # optional: a tool Danny must call in the LAST turn
     expect: >-
       What the final reply must do; MUST / MUST NOT rules for the judge.
   ```
3. The test caller is +12025550123; Beds24 is a fake with every date free and Ann Lee's booking 90001; texting and
   Slack are not configured, so texts report sent=false (write expectations that handle that).
4. If a turn would make Danny confirm something first (e.g. read back a booking number), add the guest's "yes" turn.
5. Easiest: `draft_change` with a plain description and paths [the eval file]; core writes the YAML.

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
