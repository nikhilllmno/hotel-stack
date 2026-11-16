---
name: turn-ability-on-off
description: "Turn one of Danny's abilities on or off"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Danny's abilities (tools) on calls and texts

Owner says: "Danny shouldn't change bookings by text", "turn off upset-guest alerts", "let Danny send texts during calls".

1. `agent_overview` -> `what_danny_can_do` lists each ability (internal_name) and where it is on.
2. `hotels/contigo-ranch/tools.yaml`: each tool has `channels: [voice, text]`. Remove a channel to turn it off there;
   `channels: []` turns it off everywhere. Do not delete the entry (the code expects it).
3. Check the instructions for that channel do not still tell Danny to use the ability; propose those edits too.
4. A brand-new ability needs code (src/hotelcore/tools/ + registry + tests): propose it as a code change.

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
