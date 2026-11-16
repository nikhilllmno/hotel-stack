# AGENTS.md: operating Contigo Ranch's AI front desk

You are reading this as Doss (the owner's agent on Hermes) or as a coding agent. This file is the map of the system you maintain. Keep it true: any change to how an agent works updates this file in the same change.

## What this deployment is
One hotel, **Contigo Ranch** (Fredericksburg, TX; 15 cabins/cottages; time zone America/Chicago; PMS = Beds24 property 366736). This repo, its database, its Vapi assistant, its phone number (+1 830-283-6024, voice + SMS) and its Doss container belong to this hotel only. Design: `docs/ARCHITECTURE.md`.

## The agents
| Agent | Who it talks to | Runtime | Status |
|---|---|---|---|
| Voice receptionist | Guests on the phone | Vapi assistant "Contigo Ranch" (dfce386e-cbed-470b-bfd6-d54520c13006), tools served by hotel core | Live in dev: +1 830-283-6024 -> Vapi -> core via ngrok |
| Text agent (SMS) | Guests texting +1 830-283-6024 | Hotel core: Twilio webhook -> Claude Opus 5.5 with text tools | Live in dev (Twilio SmsUrl -> core /twilio/sms via ngrok) |
| Doss | Owner and managers | Hermes | Running; Beds24 MCP connected |

## Where things live
```
hotels/contigo-ranch/        THE hotel's config. The agents' behaviour comes from here.
  facts.yaml                 every changeable value (times, fees, phones, policies' numbers), written ONCE
  kb/*.md                    knowledge base, read at runtime through search_knowledge_base
  policies/*.md              rules the guest agents must follow
src/hotelcore/
  config.py                  load_hotel(): facts + kb + policies (front matter parsed)
  render.py                  {{facts.path}} templating; a missing fact raises MissingFact
  pms/beds24.py              Beds24 API v2 client (token refresh, pagination, per-item POST checks)
  tools/                     guest-agent tools, one module each; registry.py runs them
hotels/contigo-ranch/tools.yaml   what the model sees per tool: description, parameters, channels, voice filler
hotels/contigo-ranch/prompts/voice/*.md  voice prompt sections, joined in filename order (identity, tasks,
                                  new / existing / modify reservation), then voice policies + kb topic list
hotels/contigo-ranch/voice.yaml  Vapi settings: greeting, voice, transcriber, model, timing
tests/                       `uv run pytest`
docs/ARCHITECTURE.md         decisions and component design
docs/reference-daisy.md      lessons from the previous voice agent (what to keep, what to avoid)
```

## How to change what the agents say
1. A value that appears in several places (a fee, a time, a phone number): change it in `facts.yaml` only. Every file that uses `{{facts.x}}` picks it up.
2. Wording or a new topic: edit or add a file in `kb/` (front matter: `id`, `title`, `editable`, `depends_on`).
3. A rule the agent must follow: `policies/`.
4. Verify: `uv run pytest`. The suite renders every kb and policy file and fails on any missing fact.
5. Publish to the live voice agent: `uv run python -m hotelcore.publish --author <who> --note "<what changed>"`
   (`--dry-run` first; run evals before publishing). Every publish is saved to `config_versions` (all hotels/<id>/
   files + the Vapi payload, never the webhook secret). Undo: `uv run python -m hotelcore.publish --rollback <id>`
   restores that version's files and publishes them as a NEW version. It rebuilds the prompt
   (prompts/voice.md + voice policies + kb titles) and updates ONLY the assistant named in voice.yaml. kb edits need no
   publish: search_knowledge_base reads the files at call time (core must be restarted to reload them).

## Guest-agent tools
Voice and text agents call **real APIs directly**: Vapi -> one HTTPS request to hotel core -> Beds24 REST. No MCP in that path (speed). MCP is only for Doss.

| Tool | What it does | Live latency |
|---|---|---|
| get_rooms_info | Beds24 room types + beds from facts.yaml + check-in/out times | ~1 s cold, cached 10 min |
| check_availability | Beds24 offers; drops rooms too small for the party; total + nightly average | ~0.4 s |
| find_reservation | Booking number, or last name matched over -60/+540 days (Beds24 search is unreliable); no email/phone returned | ~0.35 s |
| search_knowledge_base | Rendered kb sections by title; unknown topics return the title list | ~0 ms |
| take_message | Saves a callback request (data/messages.jsonl until Postgres + Slack) | ~0 ms |
| modify_reservation | Direct bookings only, same room. confirm=false quotes, confirm=true writes. Kept nights keep the paid price; added nights quoted from Beds24 | ~0.5 s |
| send_text | Texts one of the hotel's templates (sms_templates.yaml) via Twilio, voice + text; booking templates fill values from Beds24 and create a deposit pay link; recorded in text_messages; sent=false on failure | ~0.5-1 s |
| alert_upset_guest | Slack alert to the owner (SLACK_BOT_TOKEN); alerted=false without Slack, agent then takes a message | ~0.3 s |

Adding a tool: entry in `tools.yaml` + module in `src/hotelcore/tools/` + line in `IMPLEMENTATIONS` (registry.py) + a test. The registry refuses to load if yaml and code disagree. Tool errors are sentences the agent can say; Beds24 outages become "I can't reach our reservation system right now...".

## Text agent (SMS)
- Twilio POSTs each inbound text to `/twilio/sms`; core checks X-Twilio-Signature (HMAC of URL + params with the auth token),
  answers with empty TwiML at once, and replies in the background (`src/hotelcore/text_agent.py`).
- Danny's text prompt: `hotels/<id>/prompts/text/*.md` + policies with `used_by: [text]` + kb topics (`build_text_prompt`).
  Tools: every tool whose `channels` include `text` (alert_upset_guest is voice-only).
- Context per guest (by phone number): last 20 texts + the summary of their latest phone call.
- Storage: `text_messages` (in/out, body, Twilio sid for idempotent retries, tools used for each reply).
- Model: claude-opus-5-5 via the shared loop `src/hotelcore/claude_agent.py` (the evals use the same loop).
- Evals: `uv run python -m hotelcore.evals --channel text` (scenarios in `hotels/<id>/evals/text.yaml`).
- Opt-out: Twilio handles STOP/HELP on the A2P messaging service. Publishing is NOT needed for text changes:
  the prompt is built per message from the files (restart core to reload).

## Texts and the deposit payment link
- **Templates** live in `hotels/<id>/sms_templates.yaml`, hotel-written; the model only picks the template name, never the
  wording. Add, edit or remove a template in that ONE file: send_text's choices and their descriptions are built from it
  (`add_template_choices` in registry.py). Keep `{{facts.x}}` and the `{booking_id}`-style fields valid. Then run evals,
  restart core (text agent) and publish (voice).
  `internal: true` templates (payment_receipt) are sent by core only.
- **Payment link** (`src/hotelcore/payments.py`, table `payments`): deposit = facts.payment.deposit_percent of the Beds24
  total; link valid 24 h; an open link is reused. Provider today is `demo`: `/pay/<token>` (`src/hotelcore/api/pay.py`)
  is OUR page, "Demo payment, no card is charged", with one Pay button. Paying sets the Beds24 booking to `confirmed`,
  records `deposit`, appends a note, notifies the host, and texts the payment_receipt template. Idempotent.
  Later: Stripe Checkout (same table, provider=stripe, provider_ref = session id; confirm from Stripe's webhook).
- Flow: create_reservation (status request) -> send_text booking_confirmation -> guest pays -> booking confirmed.
- Danny knows payment status: find_reservation returns `status` + `deposit_paid` (Beds24 is the truth; confirmed with
  deposit_paid > 0 = paid). Live: a link sent during a call stores the Vapi call id (`payments.call_id`); when the guest
  pays while still on the call, core posts a "Payment update" system message to the call's monitor.controlUrl
  (`src/hotelcore/vapi_live.py`, Vapi live call control, add-message with triggerResponseEnabled) and Danny tells the
  guest at once. Ended calls are skipped; a failed announcement is logged, never shown to the guest.

## Dashboard (`dashboard/`, Next.js 16, App Router, Cache Components)
Pages: Doss (`/doss`), Call Insights (`/calls`, `/calls/[id]`), Bookings (`/bookings`), SMS logs (`/sms`), Evaluations
(`/evaluations`), AI Snapshots (`/snapshots`).
- It reads ONLY hotel core's API (`src/hotelcore/api/dashboard.py`, header `x-dashboard-key: $DASHBOARD_API_KEY`), from the
  server side (`dashboard/src/lib/api.ts`, `server-only`). The browser never sees keys or the database.
- Core API (also usable by Doss): GET /api/stats?days, /api/calls?days&intent&q, /api/calls/{id}, /api/messages?status,
  /api/bookings?days (live Beds24), /api/evals, /api/evals/{id}, /api/versions, /api/versions/{id}/diff;
  POST /api/evals/run (background, ~30 s), POST /api/versions/{id}/rollback (restores + republishes as a new version).
- Every data page wraps its data in <Suspense> (Cache Components require it); read `dashboard/node_modules/next/dist/docs/`
  before changing Next.js code (this version differs from older Next.js).
- Run: `cd dashboard && pnpm build && pnpm start --port 3000` (env in dashboard/.env.local: CORE_API_URL, DASHBOARD_API_KEY, HOTEL_TIME_ZONE,
  HERMES_API_URL, HERMES_API_KEY, DOSS_UPLOADS_DIR). Tests: `pnpm test` (node:test, `dashboard/tests/`).

## Doss's hotel-core MCP (`src/hotelcore/doss_mcp.py`, server name `hotel`)
- Read-only tools over the core API (all `readOnlyHint`, so Hermes runs them without asking): call_stats, list_calls,
  get_call (no duplicate turn list), list_text_threads, get_text_thread, list_payments, list_team_messages,
  list_eval_runs, get_eval_run (failures in full, passes by name), list_versions, get_version_diff, vapi_sync,
  core_health. Bookings/prices stay in the beds24 MCP; agent files are in Doss's sandbox at /repo.
- Auth: header `x-dashboard-key` with `DOSS_API_KEY` (hotel-stack/.env). Core's `caller()` returns "owner" for the
  dashboard key and "doss" for Doss's; owner-only routes (`require_owner`: rollback now, approvals in phase 3) answer
  403 to Doss. Doss proposes; the owner approves.
- New core routes: GET /api/payments?days&status, GET /api/health (uptime, open team messages, last eval run, payment
  counts, last call, last 30 lines of `data/logs/core.log`, where core writes warnings and errors).
- Hermes config: `mcp_servers.hotel` (uv run --directory hotel-stack python -m hotelcore.doss_mcp, trust: untrusted).
  Restart the gateway after changing tools. Tests: tests/test_doss_mcp.py.
- DB pool: connections are checked on checkout and retired after 5 idle minutes (the Supabase pooler drops idle
  connections; without the check a dead one caused a 500).

## How Doss understands the owner (plain words, never internal names)
- Same approach as Claude Code: a few general tools + context + skills, not one tool per action.
  - Context: MCP `agent_overview` (core GET /api/agents/overview, `src/hotelcore/overview.py`): what Danny can do,
    every text he sends (with a rendered example), instruction files and sections, KB topics, rules, all facts with
    values, test scenarios, voice settings, and `where_things_go` (everyday request -> file). Doss calls it first.
  - Skills (Hermes profile `skills/hotel/`): change-a-fact, update-kb-topic, change-a-text-message, add-test-scenario,
    change-danny-behaviour, turn-ability-on-off, change-voice-settings. Each: which file, conventions, how to propose.
    Keep them in sync when file conventions change (they are Doss's how-to).
  - Edits: `propose_change` / `draft_change` (the changes engine below). Small actions that are not file edits:
    `mark_team_message_done` (POST /api/messages/{id}/done) and `run_danny_tests` (POST /api/evals/run?channel=);
    these are writes, so Hermes asks the owner in the chat; the dashboard offers "Always allow" only for these hotel
    tools, never for Beds24 writes.
- SOUL.md tells Doss: the owner speaks plainly, never ask for tool/template/file names, report back in the owner's words.

## Changes engine (Doss proposes, the owner approves)
- Proposals are BAML types (`baml_src/proposals.baml`: FileEdit, ChangeProposal, ChangeReview; functions DraftChange,
  ReviewChange; client = Claude via ANTHROPIC_API_KEY). Generated client: `src/hotelcore/baml_client/` (do not edit;
  `uv run baml-cli generate` after changing baml_src). BAML tests: `uv run baml-cli test` (needs the .env loaded).
- Flow (`src/hotelcore/changes.py`): resolve edits against the live repo into before/after per file (old_text must
  match exactly once) -> row in `changes` (status checking) -> background checks in a scratch copy
  (`change_checks.py`, only what the touched areas need: render, voice/text evals, pytest, migration SQL in a
  rolled-back transaction, dashboard build; evals run as a subprocess of the scratch copy when code changed) ->
  BAML ReviewChange (summary, risk, guest impact, what to test) -> status ready or failed.
- Allowed paths: hotels/, src/, tests/, db/migrations/, dashboard/src/, baml_src/, pyproject.toml,
  dashboard/package.json. Never .env*, data/, .venv, node_modules, generated baml_client.
- Approve (owner only, dashboard /changes): every file must still match its before-hash (else "propose again"),
  files are written, then migrations / uv sync / pnpm install / baml generate / Vapi publish as needed; hotel config
  reloads in-process; code reloads because core runs with `uvicorn --reload --reload-dir src`. Undo restores the
  before-contents (refused if the files moved on, or if the change ran a migration). Reject just closes it.
- API: GET/POST /api/changes, GET /api/changes/{id}, POST /api/changes/{id}/approve|reject|undo (require_owner).
  POST body: {proposal} | {request, paths} (BAML drafts) | {rollback_version} (restore a published Danny as edits).
- Doss's MCP tools: draft_change, propose_change (edits typed as BAML FileEdit), propose_rollback, list_changes,
  get_change (checks, review, unified diff). Dashboard: /changes (diff, checks, review, Approve/Reject/Undo) and a
  proposal card in the Doss chat under the reply that proposed it.
- Two proposals that edit the same file: approving one makes the other stale; it is refused at approval and Doss
  proposes it again against the new file.

## Guest texts from Doss (`src/hotelcore/guest_texts.py`)
- Owner decisions: every text needs the owner's approval; any recipients the owner names (a booking group or any
  number); optional send time; no built-in quiet hours (the owner chooses when).
- Doss: MCP `propose_guest_texts(reason, items, send_at)`, items typed as BAML `GuestText` (to, name, text_name = a
  hotel SMS template, booking_id, or body = custom wording); skill `text-guests` (Hermes profile).
- Core renders the exact message per recipient at proposal time (templates via sms.compose; payment links are
  created then, so payment-link texts must be scheduled within 20 h), validates numbers (+E.164, no duplicates),
  max 50 per batch. Stored as a change of kind `guest_texts` (status ready; no checks, the texts are the review).
- Approve: send now, or status `scheduled` until `send_at` (hotel time); the core scheduler (asyncio task started in
  the app lifespan, every 30 s) claims due batches atomically (status `sending`) so nothing is sent twice. Reject
  cancels a scheduled batch. Texts cannot be undone. Per-recipient results in `changes.sent`
  ([{to, ok, sid | error}]); a failure (e.g. the guest replied STOP) never stops the rest. Every text is stored in
  the guest's SMS thread (tools: doss_text:change#N), so Danny sees it if the guest replies.
- Dashboard: Pending changes and the chat card list every recipient and the exact message, then sent/failed.
- Twilio's A2P registration is for guest service; promotional group texts may be filtered by carriers.

## Reports and scheduled jobs
- Reports: table `reports` (title, markdown body, kind, read_at); API `src/hotelcore/api/reports_api.py`:
  GET /api/reports (+ unread count), GET /api/reports/{id}, POST /api/reports (Doss or owner),
  POST /api/reports/{id}/read (owner only), GET /api/insights/unanswered?days (unknown KB topics from
  search_knowledge_base results, callback requests, calls ended message_taken/abandoned/quoted_no_booking).
- Doss MCP: post_report (readOnlyHint: informational, so unattended scheduled runs can post), list_reports,
  unanswered_questions. Dashboard: /reports (markdown, marked read when opened) + unread badge in the sidebar.
- Scheduled jobs are Hermes cron jobs that Doss creates when the owner asks ("every Monday at 9..."): skill
  scheduled-jobs, tool cronjob_manage (timezone America/Chicago, deliver local, the matching skill). The Hermes
  profile has `timezone: America/Chicago`. Jobs run unattended: they read, post reports and propose; they never send
  or change anything. List: `hermes cron list` (with env.sh sourced). Current: weekly "questions Danny couldn't
  answer", Mondays 9 AM (skill kb-gap-finder).
- Report skills (profile skills/hotel/): daily-summary, deposit-chaser, arrivals-preview, kb-gap-finder,
  scheduled-jobs. Extra official skills installed: excel-author, pptx-author, watchers, rss-feeds, scrapling,
  social-media-content-calendar, live-dashboard, fastmcp, archify.

## Mini apps (`src/hotelcore/mini_apps.py`, `api/apps_api.py`)
- BAML `MiniApp {slug, title, description, html, for_guests}`; table `mini_apps`; changes of kind `mini_app` (diff of
  `apps/<slug>.html`, approve upserts, undo restores the previous version or removes a new app). Doss: MCP
  propose_mini_app / list_mini_apps / get_mini_app, skill `mini-apps` (bridge sources, actions, design rules).
- Owner apps (dashboard /apps, /apps/[slug]): sandboxed iframe (allow-scripts, allow-forms, popups; no same-origin)
  plus an injected CSP (no fetch/XHR, no form posts, images data: only). Data and buttons only through the bridge
  `window.hotel.get(source, params)` / `window.hotel.act(type, payload)` -> postMessage -> dashboard route
  `/api/apps/bridge` (allow-listed SOURCES incl. reservations, availability, payments, calls, texts, team messages,
  reports...; ACTIONS propose_texts -> a guest_texts proposal, mark_message_done; ask_doss opens /doss?ask=...).
  The listener is attached in a layout effect so the app's first calls are never lost.
- Owner live data in core: GET /api/live/reservations (guest contact details), GET /api/live/availability.
- Public pages: core serves `/p/<slug>` (only rows with public = true) with a strict CSP and a bridge that reaches only
  `/p/api/availability` (no room ids, + book_url) and `/p/api/info` (allow-listed facts PUBLIC_FACTS + guest-facing
  KB, minus PRIVATE_KB). The after-hours phone and other internal facts can never reach a public page.
- Preview before approving: Pending changes -> "Preview app" (/apps/preview/[id]): live data, buttons off; public pages
  previewed through the same public endpoints. Public URL = PUBLIC_BASE_URL + /p/<slug> (ngrok for now).

## Connectors and the browser (Doss only)
- trivago: hosted MCP `https://mcp.trivago.com/mcp` (no auth), 3 read-only tools (radius search, name search, price
  trends); skill `rate-shopping`.
- Browser: Hermes `browser` toolset on for dashboard chats, `browser.cloud_provider: browserbase` (Startup plan);
  needs BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in the Hermes profile .env (this Hermes version requires the
  project id). Doss never types passwords or payment details.
- Composio (`mcp_servers.composio`, url/header from ${COMPOSIO_MCP_URL} / ${COMPOSIO_MCP_H_X_API_KEY}): a Tool
  Router session for user `contigo-owner` created by `hotel-stack/scripts/composio_session.py`
  (`uv run --with composio python scripts/composio_session.py <hermes profile .env>`; rerun after changing apps/tools).
  Direct-tools preset (not Composio's meta executor) so Hermes sees each tool's own hint: 21 read tools run freely,
  13 writes (send/draft/reply email, create/update events, sheet/drive writes, connect an account) ask the owner in
  the chat. Curated list in the script; no deletes, sharing or account settings; sandbox off.
  Apps: Gmail, Google Calendar, Sheets, Drive. Accounts connect from the chat (COMPOSIO_MANAGE_CONNECTIONS -> a
  sign-in link for the owner). Google Business Profile is NOT connected: Composio has no managed auth for it; it
  needs the hotel's own Google OAuth client with Business Profile API access, then an auth config in Composio.
- Image generation: off (owner decision).
- The owner's own Chrome (`chrome-extension/` at the workspace root, README there): the Hermes for Chrome extension
  is a side panel chat with Doss (same Hermes API server as the dashboard; `gateway.api_server.cors_origins` allows
  the fixed extension id hcedflknbknnjccddacdljlcfgocghod) that lets Doss act in the owner's real tabs and logins.
  MCP `mcp_servers.chrome` = `chrome-extension/bridge` (stdio; also a WebSocket on 127.0.0.1:8765 that only the
  extension may use: Origin chrome-extension:// + `CHROME_BRIDGE_TOKEN` from the profile .env). Tools: tabs, use_tab,
  navigate, snapshot, screenshot, act, wait (readOnlyHint, run freely) and act_with_approval (asks the owner). The
  extension decides what is risky (submit, pay, book, send, delete, cancel, confirm...): `act` refuses it and Doss
  must use act_with_approval. Password, one-time-code and card fields are always refused. Skill `chrome-browser`;
  SOUL.md says when to use it (messages from the panel start with "[From the Hermes Chrome extension").

## Doss in the dashboard (`/doss`)
- The owner chats with Doss (Hermes profile `hotels/demo-hotel`) through Hermes' API server (127.0.0.1:8642, `API_SERVER_KEY`
  in the profile .env; the dashboard holds a copy as `HERMES_API_KEY`, server-side only). Route handlers in
  `dashboard/src/app/api/doss/`: sessions (list/create), sessions/[id]/messages (`order=oldest`), sessions/[id]/stream
  (SSE passthrough of `/api/sessions/{id}/chat/stream`), approval, upload.
- UI = assistant-ui (`@assistant-ui/react`, external store runtime) on shadcn (style base-nova). Vendored components live in
  `dashboard/src/components/assistant-ui/` and `components/ui/` (added with `pnpm dlx shadcn@latest add @assistant-ui/<name>`,
  registry in components.json; excluded from lint). Our state stays ours: `src/lib/doss-events.ts` turns stream events and
  stored transcripts into turns/steps (`tool_call` batches unwrapped, `delegate_task` as a subagent, file/skill/memory
  writes as diffs), `src/lib/doss-messages.ts` converts turns to assistant-ui messages (steps = tool-call parts;
  approvals and the run footer = `data-hermes_approval` / `data-hermes_run_summary` parts), `src/app/doss/chat.tsx` wires
  the runtime (onNew -> stream, onCancel -> /v1/runs/{id}/stop, attachments -> /uploads, thread list -> Hermes sessions),
  `src/app/doss/tool-card.tsx` renders steps (live feed, expandable output, diff), the tool group (open while running),
  approval cards and the footer (model, tokens, cost = change in the session's `estimated_cost_usd`).
- Approvals: `approval.request` on the session stream carries `run_id`, `request_id`, `execution_generation`; answer with
  POST `/v1/runs/{run_id}/approval` `{request_id, execution_generation, choice}` (exactly these keys). An unanswered
  approval fails closed after `approvals.timeout` (300 s) and blocks that chat until then.
- Uploads: saved to `hotels/demo-hotel/uploads/`, mounted in Doss's sandbox at `/uploads`; the message lists the paths.
- API-server chats count as "unattended" in Hermes: `execute_code` is blocked there; Doss runs Python with the terminal
  tool (inside its Docker sandbox). Do NOT set `approvals.unattended_mode: approve`: it would also auto-approve Beds24
  writes in runs that have no chat attached (e.g. background subagents).
- Subagents (`delegate_task`) run in the background; their answer arrives later as a new message, so the chat polls.
- Questions (`clarify`, on for the API server; `agent.clarify_timeout: 900` in the Hermes config): Doss asks when a
  request is unclear or missing a value (SOUL.md "Ask when something is unclear or missing"; the hotel skills say the
  same). Hermes does not put the question on the chat stream: it is a pending prompt on the run. The chat polls
  GET /v1/runs/{run_id} (dashboard route /api/doss/runs/[id]) while a clarify step runs, shows each question as a card
  (choice buttons with the recommended one marked, "Other" text, multi-select, a plain field for open questions,
  Skip), and answers with POST /v1/runs/{id}/clarify {request_id, execution_generation, answer} (route
  /api/doss/clarify). A multi-question form arrives one question at a time; Doss gets {responses, outcome} back.

## Data (Postgres on Supabase)
Project `contigo-ranch` (ref lfrfabzcrcqpubpkqwnf, us-east-1, free plan). Connection: `DATABASE_URL` in .env
(session pooler). Tables are NOT exposed through Supabase's Data API; only hotel core reads/writes them.
Schema: `db/migrations/*.sql`, applied with `uv run python -m hotelcore.db migrate` (idempotent).
| Table | Holds |
|---|---|
| calls | one row per call: transcript, turns, summary/intent/outcome/sentiment (written by core), booking made, cost, raw Vapi report |
| tool_calls | every tool call: name, arguments, ok, result/error, ms |
| team_messages | take_message requests for staff (status open/done) |
| config_versions | every publish: files of hotels/<id>/ + the Vapi payload (diff + rollback) |
| eval_runs | eval results per run (scenario pass/fail, replies, verdicts) |
| text_messages | SMS thread per guest phone: in/out, body, Twilio sid, tools used (send_text texts included) |
| payments | deposit pay links: token, booking_id, guest_phone, amount, provider (demo), status open/paid/expired, paid_at, call_id |
How data arrives:
- Every tool call -> `tool_calls` (written after the response is sent, so it adds no latency).
- `take_message` -> `team_messages`.
- Vapi end-of-call report -> `calls`, then Claude (claude-opus-5-5, low effort) writes `summary`, `intent`,
  `outcome`, `sentiment` (`src/hotelcore/calls.py`). Bookings made on the call are taken from the
  create_reservation result into `booking_id` / `booking_amount`.
Commands: `uv run python -m hotelcore.calls analyze` (re-analyze calls missing a summary),
`uv run python -m hotelcore.calls backfill` (load old data/*.jsonl; data/*.jsonl is legacy now).
Supabase API keys (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY) are in .env for the dashboard.

## Evals: run after every prompt, kb, policy, facts or tool change
`uv run python -m hotelcore.evals` (or `... evals "<name substring>"` for one scenario). About 30 s, results saved to `eval_runs`.
- Scenarios: `hotels/contigo-ranch/evals/voice.yaml` (say / tool / expect; fact placeholders allowed).
- Claude plays the agent with the REAL voice prompt and tools against a fake Beds24 (`src/hotelcore/fake_pms.py`:
  every date free, Ann Lee has booking 90001). SMS and Slack are absent, so fallback paths are tested.
- A scenario passes when the required tool was called in the last turn (partial argument match) AND a Claude judge
  says the final reply meets `expect`. Read the stored transcript before changing anything: a failure can be the
  script (e.g. too few guest turns), not the agent.
- The live voice model is gpt-4.1 on Vapi; evals test the prompt and tools with Claude, not gpt-4.1 itself.
Baseline: 14/14 (eval_run 4). Never publish a change that lowers the pass count without the owner agreeing.

## Prompt placeholders
`{{facts.path}}` from facts.yaml; `{{today}}` and `{{caller_number}}` become Vapi call-time variables at publish.
The agent's name is `facts.agent.name` (Danny). Prices are quoted "plus taxes" (`facts.payment.prices_include_taxes: false`).

## Vapi is read-only: the repo is the source of truth
- Vapi keeps its own versions. Inbound phone calls use the assistant's CURRENT published version; the Vapi dashboard
  (and its "Talk" button) shows/uses YOUR per-user draft, which can be stale. Editing in the Vapi UI caused real drift
  (2026-11-10: UI-published v2-v4 used another voice; a stale draft greeted web calls differently).
- Never edit Danny in the Vapi dashboard. Change files in hotels/<id>/ and publish.
- `uv run python -m hotelcore.publish --check` compares live Vapi + any UI drafts with the last repo publish.
  Publishing refuses on drift unless `--force`. The AI Snapshots page shows the same check (GET /api/vapi/drift).
- Stale drafts: a Vapi dashboard tab left open on the assistant autosaves its old copy as a draft when a publish changes
  the assistant (2026-11-10: a draft identical to v2-v4 appeared 5 s after a publish; nobody had edited). The check
  labels each draft "unchanged copy of old vN" (same prompt, model, voice, timing as a past version) or "NEW edits".
  Publish discards unchanged copies automatically and still refuses on NEW edits. Close Vapi dashboard tabs after use.
- To keep a change someone made in the Vapi UI: copy it into the hotel files, run evals, discard the draft
  (DELETE /assistant/{id}/draft/{draftId}), then publish.

## Rules
- Never put secrets in this repo. Credentials live in `.env` files that git ignores.
- Never edit a file whose front matter says `editable: false` without the owner's explicit say-so.
- Beds24 writes (bookings, prices, minimum stay) always go through owner approval.
- Prices come from Beds24 quotes, never from memory or the kb. A quote is the total for the whole stay.
- Guest personal data stays inside this deployment.

## Run it (dev)
```bash
uv run uvicorn hotelcore.api.app:app --port 8000     # hotel core; warms Beds24 cache at startup
ngrok http 8000                                      # public URL -> PUBLIC_BASE_URL in .env, then publish
```
Vapi sends tool calls and end-of-call reports to `$PUBLIC_BASE_URL/vapi/webhook` with header `x-vapi-secret`
(wrong/missing -> 401). Calls are stored in data/calls.jsonl, messages in data/messages.jsonl (until Postgres).
The Vapi org also holds an unrelated assistant "Riley": never modify it.

## Verify the system
```bash
uv sync && uv run pytest
```
