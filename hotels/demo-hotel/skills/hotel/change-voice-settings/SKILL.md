---
name: change-voice-settings
description: "Change Danny's greeting, voice, model or call length"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Danny's voice settings

Owner says: "change the greeting", "use a different voice", "calls can be up to 20 minutes".

1. `agent_overview` -> `voice` shows the current greeting, voice, model and max call length.
2. File: `hotels/contigo-ranch/voice.yaml` (first_message = greeting, end_call_message, voice, model,
   start_speaking, max_duration_seconds). Greetings use `{{facts.x}}` placeholders; keep the recorded-line notice.
3. Voice ids must exist in Vapi; if the owner names a voice you cannot verify, say so and ask.
4. Approving publishes Danny to Vapi immediately; mention that the next call uses the new settings.

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change, fix, and propose again.
