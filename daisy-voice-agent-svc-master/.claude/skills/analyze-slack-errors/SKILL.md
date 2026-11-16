---
name: analyze-slack-errors
description: Analyze the daisy-voice-agent-svc production error-alert Slack channel (#dextrai-aws-prod-alerts-daisy) over a time range, categorize the alerts, and spawn AWS CloudWatch investigation agents for anything that looks like a real infrastructure/integration failure rather than routine guest-input noise. Use this whenever the user asks to review, triage, or analyze prod alerts, error alerts, the AWS alerts channel, CloudWatch errors, or "what's been breaking" for the Daisy service — even if they don't name the channel, say "skill", or give exact dates, e.g. "check the prod alerts channel", "what's erroring lately", "any critical errors this week", "triage the daisy alerts from yesterday".
---
# Analyze Slack Errors

Fetch, categorize, and triage alerts from the Daisy voice-agent production error channel, and dig into anything that looks like a real (not guest-caused) failure using CloudWatch.

## Arguments

Parse `$ARGUMENTS` as free text, space-separated, order-independent:

- **A time expression is effectively required.** Natural language is fine — `since aug 8 6pm ist`, `last 24h`, `today`, `from monday`. If none is given, default to the last 24 hours from now.
- `channel=<id>` — Slack channel ID to read, e.g. `C0A06AGE69G`. Default `C0A06AGE69G` (`#dextrai-aws-prod-alerts-daisy`). **Always resolve by ID, never by name.** If the user names a channel in plain language ("the prod alerts channel," "dextrai-aws-prod-alerts-daisy"), that's just confirming they mean the default — don't go search Slack for a channel matching that name. Name-based search is unreliable here: this workspace has multiple similarly-named channels (a shared multi-service alerts channel, and a dev-environment one) that a name search can return instead of the right one, and you won't necessarily notice the mistake since they carry real-looking data too. Only switch channels if the user gives you a literal different ID (starts with `C`) or explicitly says to search for one.
- `workspace=<url>` — Slack workspace. Default `https://keyvaluesystems.slack.com`.
- `log-group=<name>` — CloudWatch log group used for investigation. Default `/ecs/dextr-prod-ca-daisy-agent`.
- `region=<aws-region>` — Default `us-west-1`.
- `profile=<aws-profile>` — AWS CLI profile. Default `dextr-prod`.
- `ignore=<pattern>[,<pattern>...]` — substrings to exclude entirely (case-insensitive match against the raw alert text). There is **no built-in ignore list** — every exclusion has to be named this run, either as `ignore=` or in plain language ("ignore the X error"). Don't carry exclusions over from memory of a previous run; ask or infer fresh each time.

## Step 1 — Resolve the time window

Convert the time expression to Unix epoch seconds. Alerts in this channel are discussed in IST even though the underlying log timestamps are UTC — if the user's time has no explicit zone, assume IST. Example:

```bash
# macOS / BSD date:
date -j -f "%Y-%m-%d %H:%M:%S %z" "2026-08-08 00:00:00 +0530" "+%s"
# GNU / Linux date (coreutils rejects -j):
date -d "2026-08-08 00:00:00 +0530" "+%s"
```

Pick the form that matches the shell you're running in — the BSD `-j` flag fails on GNU coreutils and vice versa. Get "now" from the shell (`date "+%s"`, portable on both) — never assume or hardcode it.

## Step 2 — Pull the messages

Load the `agent-slack` skill if it isn't already loaded. Fetch with:

```bash
agent-slack message list <channel> --workspace <workspace> --oldest <epoch>.000000 --limit 200 --max-body-chars -1
```

`--limit` caps at 200 per call. If a batch comes back with exactly 200 messages, the window likely has more — take the last message's full `ts` and re-run with `--oldest <last_ts>` **verbatim** (e.g. `--oldest 1789395177.590409`). `--oldest` is exclusive, so Slack already skips the boundary message; do **not** truncate to whole seconds or add `1`, which would drop any message posted in the sub-second gap after `last_ts`. Keep paging until a batch returns fewer than 200 (including zero). Combine every batch before moving on; don't categorize partial data.

## Step 3 — Parse and normalize each alert

This channel carries more than one alert template — don't assume they're all the same shape:

- **Log-based alerts** (the majority): a message with a fenced ````{...}```` JSON blob containing `context`, `level`, `message`, `timestamp`, and sometimes `client`/`status`/`url`.
- **Structured business alerts**: e.g. "🚨 *Payment completed but PMS reservation was never created*" with `> *Hotel*` / `> *Guest*` / `> *Amount*` fields and no JSON blob.

For each alert, extract: the human-readable error message, the `requestId` (or best available correlation ID for non-JSON alerts), any `hotelId`/`assistantPhoneNumber`/guest identifiers, and the timestamp. If a message doesn't match the known JSON pattern, don't discard it — read its own field structure instead.

## Step 4 — Apply ignores

Drop any alert whose raw text case-insensitively matches an ignore pattern from this run's arguments or the user's plain-language instructions. Report how many were dropped and by which pattern — silent over-exclusion can hide a real problem, so always surface the count.

The same underlying hotel/incident can show up under different identifiers in different alert templates — a structured business alert might name a hotel ("Lititz Pointe Inn &amp; Suites"), while a log-based alert for the exact same hotel only carries its UUID. A text match on the ignore pattern won't catch the second one. So before reporting anything as a new critical finding in Step 6/7, check whether it matches one you already dropped in this step. A shared hotelId, guest identity, or phone number alone is **not** enough — a hotel ignored for one reason can still have a genuinely different failure. Only fold the later alert into the ignored count when **both** the shared identifier **and** the same underlying incident/error signature match (i.e. it's demonstrably the same failure wearing a different alert template). If the identifier matches but the error signature is different — a payment, integration, or infrastructure failure the ignore pattern never described — treat it as a fresh candidate and let Steps 6/7 investigate it. When it is the same incident, still mention it once if there's something notable like an unreconciled charge, rather than reporting it as a fresh critical cluster.

## Step 5 — Categorize

Group the remaining alerts by normalized error signature, not by `requestId` — a single guest interaction commonly logs the same underlying failure twice (once from a low-level `BaseError.BaseError` catch, once from the calling service). Present as a count-per-category table.

Most of what lands here is **expected, benign, guest-input-driven noise**: a guest gave a past check-in date, misspelled their name, tried an expired payment link, asked about a reservation that doesn't exist, hit a same-day-booking cutoff. That's the system correctly rejecting bad or ambiguous input, not a bug — recognize it as such and don't over-flag it.

## Step 6 — Identify what's actually critical

Flag a cluster as critical when it looks like an **infrastructure, integration, or code-gap failure** rather than a guest mistake. Signals worth weighting heavily:

- An external PMS/payment/telephony vendor returning 5xx, 403, or 422 on a *write* call (booking creation, card charge) — especially "payment succeeded but no reservation was created" patterns, since that's a direct financial/reconciliation problem.
- A literal code gap — "not implemented," an unhandled exception type, a stub throwing where a real implementation belongs.
- Network/DNS/connection failures (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, timeouts).
- Anything touching compliance-sensitive data (call recording persistence, HIPAA storage) failing with no visible retry.
- Rate-limiting (429) on a path that matters (recording capture, payment processing) — one occurrence may be a blip, recurring is not.
- Routing/config gaps — e.g. "no hotel found for assistant phone number" on a live number.

When genuinely unsure whether something is noise or a real gap, lean toward investigating — a wasted investigation agent is cheap; a missed reconciliation problem involving real guest money is not.

## Step 7 — Investigate critical clusters via CloudWatch

For each critical cluster (cap at ~4 running in parallel; if there are more candidates, say so explicitly and pick the ones with the clearest financial, compliance, or systemic impact — never silently drop candidates without naming them), spawn a background `general-purpose` agent per issue. Since agents share no memory of this conversation, give each one everything inline:

- The exact alert content and `requestId`(s) involved
- The log group, region, and an instruction to `export AWS_PROFILE=<profile>` before any `aws` command
- A computed CloudWatch time window (±5 min padding around the alert timestamp, in epoch milliseconds) and the command shape:
  ```bash
  aws logs filter-log-events --log-group-name "<log-group>" \
    --filter-pattern '{ $.context.requestId = "<id>" }' \
    --start-time <ms> --end-time <ms> --region <region>
  ```
- A request to also search the *full analysis window* for the same error signature, to determine one-off vs. recurring, and how many hotels/requestIds are affected
- A reminder this is read-only: no code changes, no AWS mutations, no Slack writes
- A request for financial/compliance impact and a concrete recommendation, in under ~300 words

Launch every investigation agent for this run together — a single message with multiple `Agent` tool calls, `run_in_background: true` — so they run concurrently rather than serially.

**If you're running this in a normal back-and-forth conversation**, that's it — you'll get a notification per agent as it finishes, and you report each one when it lands (see Step 8). **But if you have no future turn to come back to** — you're a one-shot subagent, or otherwise need to hand back a single finished answer right now — backgrounding is the wrong move: nothing will ever read a follow-up from you. In that case, either run the investigations one at a time in this same turn instead of backgrounding them, or background them and then explicitly wait for every one of them to finish and fold their results in before you write your final answer. Never end your turn with an investigation still outstanding — a report that says "still waiting" or "pending" when you had the tools to just finish is an incomplete deliverable, not a progress update.

## Step 8 — Report

Send the routine-category breakdown as soon as it's ready; don't hold it hostage to the investigations. Structure:

1. Time window analyzed, total alert count, and how many were dropped by which ignore pattern(s)
2. Category table for the routine/noise alerts, with counts
3. A "Critical findings" section, one entry per investigated cluster, filled in as each agent completes: root cause, one-off vs. recurring, financial/compliance impact if any, and a concrete recommendation

## Hard rules

1. This is read-only investigation and reporting. Never modify code, send Slack messages/reactions, or mutate AWS state as a side effect of running this skill. The only AWS commands you may run are read-only `aws logs` queries and the `aws sts get-caller-identity` preflight check.
2. Never invent or reuse a default ignore pattern — only exclude what was explicitly named in this run.
3. If Slack or AWS auth isn't working (`agent-slack auth whoami` fails, or `aws sts get-caller-identity --profile <profile>` fails), say so immediately rather than guessing at data or proceeding without it.

