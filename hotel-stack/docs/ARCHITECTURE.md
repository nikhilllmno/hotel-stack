# Hotel Stack Architecture

AI front desk for independent hotels: a voice receptionist, a text agent linked to it, an owner dashboard, and Doss, the owner's agent. Decided 2026-11-10.

## Decisions

| Area | Choice | Notes |
|---|---|---|
| Voice runtime | **Vapi** (v1) | Phone, STT, TTS, barge-in. Only `publish` and the Vapi webhook know Vapi; LiveKit Agents is the fallback if latency control matters. |
| Text agent | **Own Python LLM loop** | SMS (Twilio) and WhatsApp (Gupshup). Vapi SMS lacks first-message, KB search, non-Twilio. |
| Hotel core | **Python + FastAPI** | All hotel logic, all tools, all PMS calls. Every agent is a thin client of it. |
| PMS | **Beds24 API v2** | Called only from core (and the Doss MCP, which reuses core's client). |
| Database | **Postgres on Supabase** | Guests, conversations, calls, config versions, audit. |
| Dashboard | **Next.js** on Vercel | Calls, messages, metrics, config editing, Doss chat. |
| Owner agent | **Doss on Hermes** | One container per hotel. Channels: dashboard chat, Telegram/Slack. |
| Models | **OpenRouter** | Fast model for voice; stronger for text and Doss. |
| Tracing | **Langfuse** | Every LLM call and tool call, tagged with hotel, agent, session. |
| Hosting | Supabase + container host (Fly.io / Railway / VM) + Vercel | Doss needs Docker for its sandbox. |

## Components

```
                 hotels/<hotel-id>/   config as code, the single source of truth
                 facts.yaml  prompts/  kb/  policies/  tools.yaml  voice.yaml
                        |  edit (dashboard or Doss) -> validate -> publish vN
                        v
+-------------+  tool-calls   +--------------------------------------------+   +---------+
| Vapi        |-------------->| HOTEL CORE (FastAPI)                       |-->| Beds24  |
| voice agent |<--------------|  config: load, render, validate, publish   |   +---------+
|             |  end-of-call  |  tools: one registry, used by every agent  |   +---------+
+-------------+  report       |  guests + conversations (Postgres)         |-->| Twilio  |
+-------------+               |  summaries, metrics, audit                 |   | Gupshup |
| Text agent  |-------------->|  dashboard API                             |   +---------+
| SMS/WhatsApp|  in-process   +--------------------+-----------------------+
+-------------+                                    |
+-------------+  REST                              | MCP: beds24, hotel-core
| Dashboard   |<-----------------------------------+
| (Next.js)   |  Doss chat ----------------------> DOSS (Hermes container per hotel)
+-------------+                                    also Telegram / Slack
```

### Hotel core (`core/`, `api/`)
- **Config**: loads `hotels/<id>/`, renders `{{facts.x}}` into prompts, validates (schema, length caps, injection scan), publishes immutable versions.
- **Tools**: one Python registry. `tools.yaml` declares each tool's description, JSON schema and channels (`voice`, `text`, `doss`). The same implementation serves Vapi (HTTP), the text agent (in-process) and Doss (MCP).
- **Guests and conversations**: one guest per phone number (E.164). Calls and texts share one timeline. Single hotel per deployment, so no tenant column.
- **Events**: Vapi `end-of-call-report` -> store transcript, summarize, update metrics, optional follow-up text.

### Voice agent (Vapi)
- One Vapi assistant per hotel, **synced by `publish`** (system prompt, first message, voice, transcriber, tools, server URL). Nobody edits it in the Vapi dashboard.
- Tools are Vapi function tools whose server URL is core's `/vapi/tool-calls`; core runs them and returns results.
- Core's `/vapi/events` receives status updates and the end-of-call report.
- Latency: tune Vapi's start-speaking plan (wait time, smart endpointing). Vapi starts the LLM when it predicts end of turn and aborts if the caller continues; there is no explicit preemptive-generation switch.

### Text agent (`text_agent/`)
- Inbound: Twilio SMS and Gupshup WhatsApp webhooks -> resolve guest -> LLM loop with `text`-channel tools -> reply.
- Context: rendered `prompts/text.md` + the guest's timeline, including the latest call summary.
- Outbound: tool-driven (`send_text` with hotel templates, from calls and texts; deposit pay links), follow-ups after calls, scheduled messages (pre-arrival).

### Doss (`doss/`)
- Hermes profile per hotel: `SOUL.md`, narrowed toolsets, Langfuse plugin, `hotel-trace` plugin.
- MCP servers: `beds24` (reads free, writes gated by Hermes approval) and `hotel-core` (calls, metrics, guests, config proposals, sending messages).
- Doss proposes config edits; they go through the same validate -> publish path as dashboard edits.

### Dashboard (`dashboard/`)
- Calls and messages with summaries, outcomes and transcripts; metrics (answer rate, containment, bookings, handoffs).
- Config editor: draft -> preview/test -> publish -> rollback.
- Doss chat panel via Hermes API server.

## Config as code (`hotels/<hotel-id>/`)

```
facts.yaml        every changeable value, written once; prompts and KB use {{facts.path}}
prompts/
  voice.md        voice system prompt (short: latency)
  text.md         text system prompt
kb/*.md           knowledge base, read at runtime by search_knowledge_base
policies/*.md     rules the agents must follow
tools.yaml        tool definitions + channels
voice.yaml        Vapi settings: voice, transcriber, model, first message, timing
```

Publish rules:
1. Every publish creates version N (stored in Postgres with author and diff).
2. A call or chat in progress keeps the version it started with.
3. KB files are read through a tool, so KB edits apply immediately; prompt edits apply to new calls.
4. Rollback = republish version N-1.

## Data model (Postgres)

| Table | Holds |
|---|---|
| `hotel` | one row: name, timezone, PMS property id, Vapi assistant id |
| `config_versions` | hotel, version, rendered config, author, created_at |
| `guests` | hotel, phone (E.164), name, notes |
| `conversations` | hotel, guest, channel (voice / sms / whatsapp), external id, started/ended |
| `messages` | conversation, role, content, created_at |
| `calls` | conversation, duration, summary, outcome, cost, recording URL |
| `tool_calls` | conversation, tool, args, result, ok, latency (audit) |
| `config_proposals` | hotel, proposed by (owner / Doss), diff, status |

## Deployment model: one hotel per deployment
This repo is built for one hotel (Contigo Ranch). Every hotel gets its **own deployment**: its own core service, Postgres database, Vapi assistant, phone number, Doss container, and credentials. Nothing is shared between hotels at runtime, so one hotel's data, keys or outage can never reach another.

## Agent context: Hermes must be able to operate the voice agent
Doss is not only a chat assistant; it maintains this hotel's agents. Everything it needs to act safely is written down in the repo, next to the code:
- `AGENTS.md` (root): what each part does, where config lives, how to change prompts/KB/tools, how to publish, how to inspect calls, what never to touch.
- Every tool in `tools.yaml` carries a description written for the model and notes on side effects.
- Every call is stored with transcript, tool calls, summary and structured outputs, so Doss can answer "why did the agent say that?".
- The repo is mounted into Doss's sandbox; edits go through the same validate -> publish path as the dashboard, with owner approval.
- When we change how the voice agent works, we update `AGENTS.md` in the same change.

## Isolation and secrets
- PMS, telephony and messaging credentials live only in core (and Doss's MCP), never in Vapi, the dashboard or a sandbox.
- Doss runs in its own container per hotel because it has a shell.
- Every write to Beds24 from Doss needs owner approval in Hermes; guest-facing agents can write only through the tools their channel allows.

## Build order
1. Monorepo scaffold; `core` package with config loader/renderer and the Beds24 client (moved from `beds24-mcp`).
2. Tool registry + the first tools (rooms info, availability/quote, find reservation, KB search, take message).
3. Vapi: publish one hotel's assistant; `/vapi/tool-calls`; test a real phone call.
4. Postgres schema; `/vapi/events` stores calls; summaries.
5. Text agent on Twilio SMS; guest timeline shared with voice.
6. Dashboard v1: calls, messages, metrics.
7. Config editor with publish/rollback; `hotel-core` MCP for Doss.
8. WhatsApp (Gupshup); scheduled messages.

## Decided 2026-11-10 (continued)
- **Phone number**: +1 830-283-6024 (Twilio account "Dextr AI (test)", ACd16c...). Voice + SMS. Added to messaging service "Low Volume Mixed A2P Messaging Service" (MG61a2...), whose campaign is **Verified** (Low Volume Mixed). Inbound SMS uses the number's own webhook ("Defer to sender's webhook"). Production: move Contigo to its own Twilio subaccount and brand, like the other hotels (002-007).
- **Booking on calls**: after reading back dates, room and total, create the Beds24 booking with status `request`. Staff confirm and take payment. No card details on calls.
- **Staff alerts**: Slack (call summaries, transfer failures, messages) + dashboard.
- **Vapi**: org "nikhil.m@dextr.ai's Org" (separate from the Dextr org that holds other hotels). Key in `.env` as `VAPI_API_KEY`. The org has an unrelated assistant "Riley": never modify it. Contigo's assistant is named "Contigo Ranch".

## Open questions
- Which hotels use WhatsApp via Gupshup.
- Vapi model routing: Vapi's own provider or custom LLM URL via OpenRouter (verify latency).
