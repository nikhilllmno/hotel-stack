---
name: change-a-fact
description: "Change a price, time, phone, link or other hotel value"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, danny, change]
    category: hotel
---
# Change a hotel fact (price, time, number, link, address)

Owner says things like: "check-in is now 4 PM", "the pet fee is $100", "new wifi password is ...", "our phone number changed".

1. `agent_overview` -> `facts` lists every value with its dotted path (e.g. `checkin.time`, `pets.fee`, `wifi.password`).
2. Every prompt, KB topic and text reads these values as `{{facts.<path>}}`, so changing the value in
   `hotels/contigo-ranch/facts.yaml` updates Danny everywhere. Do not edit the value inside KB or prompt files.
3. Read /repo/hotels/contigo-ranch/facts.yaml, then `propose_change` with one edit replacing the exact line
   (keep the YAML indentation and any trailing comment).
4. A value that does not exist yet: add it under the right section in facts.yaml AND reference it where it is used
   (usually a KB topic); propose both edits in one change.
5. A policy change (not just a new number, e.g. "cats are allowed now"): search_files the whole hotel dir for the
   topic word first. The same rule is written as plain text in several places that facts.yaml does not drive:
   kb/<topic>.md, policies/<topic>.md, prompts/voice + prompts/text (booking steps), and tools.yaml parameter
   descriptions. A leftover sentence ("No cats") contradicts the new fact, so edit them all in one change and add any
   new fact to each file's `depends_on`. Check src/hotelcore/tools/ too: if code hard-codes the old meaning
   (e.g. a booking note label), route the new case through an existing field (notes) rather than proposing code.
6. Ask every follow-up the new policy needs in ONE clarify call up front: limits (separate or combined), how the fee
   is charged (per unit / per night / per item) and whether it stacks with existing fees, which existing rules apply.
   Two rounds of questions cost the owner an extra form.

## After proposing
- `get_change(change_id=N)` right after proposing usually shows `checking` with no results; check again before
  answering "is it live?".
- Status `failed` from an eval: compare with the latest baseline run (`list_eval_runs`, then `get_eval_run` on the
  previous voice/text run). If the same scenario already failed before your change, tell the owner it is a
  pre-existing problem unrelated to this change, name which tests covering the change passed, and offer: approve as is,
  or fix the old failure first. Only rework your change if a related scenario failed.
- Tell the owner about downstream effects the change does not cover: Danny's quotes do not add pet/extra fees
  (team charges them by hand), and the website/OTA listings still show the old policy.

## Always
- The owner speaks plainly. Never ask them for file, tool or template names; find them with `agent_overview` and by reading /repo.
- If the request is ambiguous or missing a value (which cabin? which date? exact wording? calls, texts or both?), ask with the `clarify` tool (choices where obvious, recommended first; free text for values) before proposing.
- Read the current file in /repo before editing. With `propose_change`, `old_text` must be copied exactly from the file (it must appear once).
- Title the change in the owner's words ("Check-in moves to 4 PM"), give the reason, then tell the owner: the change number, what it does in one sentence, and that it waits for their approval on Pending changes. Never say it is live until get_change shows status applied.
- If checks fail, read get_change(change_id=N), fix, and propose again.
- If the only failing test has nothing to do with the change, check list_eval_runs / get_eval_run to see whether it also fails on the live version (flaky). If it does, re-propose the identical edits to re-run the checks, and offer to fix the flaky test as a separate change. Doss cannot approve changes; only the owner can, on Pending changes.
