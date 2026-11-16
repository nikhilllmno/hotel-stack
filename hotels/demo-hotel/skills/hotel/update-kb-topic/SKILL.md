---
name: update-kb-topic
description: "Add, update or remove something guests ask about"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Knowledge base topics (what Danny knows to answer guests)

Owner says: "tell guests about the new hot tub", "breakfast is no longer served", "add info about the farmers market".

1. `agent_overview` -> `knowledge_base` (titles) and `kb_files`. Danny searches these by title on calls and texts.
2. Update: read the file, `propose_change` with old_text/new_text. Remove a topic: `delete: true` (or remove the
   section if only part is gone).
3. New topic: create `hotels/contigo-ranch/kb/<NN>-<slug>.md` (next number) with front matter:
   ```
   ---
   id: <slug>
   title: <Title guests would use>
   editable: true
   depends_on: [facts.<path>, ...]   # every {{facts.x}} the body uses
   ---
   # <Title>
   * short factual bullets
   ```
4. Put changeable values (prices, hours, links) in facts.yaml and reference them as `{{facts.x}}` (see change-a-fact).
5. Never invent details the owner did not give; ask.
6. A policy is also written in policies/<topic>.md and in prompt/tool wording; a KB edit alone leaves Danny
   contradicting himself. For policy changes follow change-a-fact steps 5-6 and its "After proposing" section
   (pre-existing eval failures, downstream effects).

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
