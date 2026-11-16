---
name: scheduled-jobs
description: "Set up, list, change or stop recurring reports and jobs"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, reports]
    category: hotel
---
# Scheduled jobs (the owner asks in plain words)

Owner says: "every morning at 8 send me a summary", "chase unpaid deposits every day at 10", "stop the Monday
report", "what runs automatically?".

1. Use the `cronjob_manage` tool:
   - create: `schedule` in plain form ("every day at 8am", "every monday 9am", "weekdays at 7am", "in 2h"),
     `timezone` "America/Chicago", a self-contained `prompt` (what to cover, the period, "publish with post_report"),
     `skills` [the matching hotel skill: daily-summary, deposit-chaser, arrivals-preview, kb-gap-finder, ...],
     `deliver` "local", a clear `name`.
   - list before create (avoid near-duplicates) and before update / pause / resume / remove (never guess job ids).
   - In the prompt, pin the data window precisely ("the 7 days ending yesterday", "state the exact dates") and the
     report title/kind, and say what to do on a quiet period ("if nothing, say so in one short report").
2. "Run it once now so I can see it": in a chat, do the run inline yourself (load the job's skill, gather the data,
   `post_report`) rather than `cronjob_manage run` — run fires in the background, the result comes back later,
   and you cannot show the owner the report in this reply. Use `run` only to test the job itself.
3. Jobs run unattended: they may read, post reports and PROPOSE changes or texts (the owner approves later); they
   never send or change anything themselves.
4. Confirm back in plain words: what runs, when (hotel time, with the first run date from next_run_at), and that
   results appear on the Reports page.
5. If the request is vague (which time? which day? what to include?), ask with `clarify` first.
