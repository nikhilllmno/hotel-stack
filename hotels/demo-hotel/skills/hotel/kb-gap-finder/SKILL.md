---
name: kb-gap-finder
description: "Find what guests asked that Danny couldn't answer"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, reports]
    category: hotel
---
# KB gaps (kind: kb-gaps)

Owner asks: "what did guests ask that Danny couldn't answer?", or the weekly scheduled job.

1. In one batch: `unanswered_questions(days)` (default 7), `call_stats(days)`, `list_text_threads(days)`,
   `agent_overview`. unanswered_questions covers unknown KB topics, callback requests and calls needing follow-up,
   but NOT text conversations — always list text threads separately or SMS gaps are missed.
2. Read the real conversations (`get_call(call_id)`, `get_text_thread(phone)` — the argument is `phone`, not
   guest_phone) to find the actual questions; group similar ones. Ignore hang-ups with no question.
   - A text where Danny answered without a KB search (tools empty) but correctly is not a gap.
   - Before blaming a behaviour seen in an old call (wrong greeting, wrong name), compare it with the current
     settings in agent_overview (greeting, voice) and `vapi_sync`; if the call predates the current config, say
     it is "probably already fixed" rather than proposing a fix.
   - Callback requests that exist because Danny lacks an ability (e.g. changing a guest name) are ability gaps,
     not KB gaps: report them separately and note whether Danny handled them correctly by taking a message.
3. For each gap: what guests asked (with a short quote), how often, and whether the answer exists in the KB
   (agent_overview knowledge_base) under another title.
4. For gaps where the owner's answer is known from facts/KB: propose KB additions (update-kb-topic skill,
   `propose_change` or `draft_change`), one change for the batch. For gaps that need the owner's knowledge, list
   the exact questions for them to answer.

## Quiet weeks
If there are no real gaps, still publish: lead with "No knowledge gaps this week", a small counts table (calls
booked/ended early, text conversations, missing topics searched, callbacks taken), the handoffs to the team, and
only optional next steps. Never invent gaps to fill the report.

## Always
- Data first: hotel tools (`call_stats`, `list_calls`, `get_call`, `list_text_threads`, `list_payments`,
  `list_team_messages`, `unanswered_questions`) and Beds24 (`get_arrivals`, `list_reservations`, `find_reservations`).
- Times and dates are hotel time (America/Chicago); say the exact dates you covered.
- Write for the owner: numbers and names first, short headings and bullets, a small table when it helps, no internal
  names (say "the booking-link text", not booking_link). End with "Suggested next steps" (each one a concrete thing
  Doss can do if the owner says yes).
- Publish with `post_report(title, markdown, kind)`; in a chat also give a 2-3 line summary and say it's on the
  Reports page. Anything that would change something (texts, KB, prices) is proposed, never done directly.
