# Studying Hermes Agent for a Single-Hotel Harness

Source: `hermes-agent/` (NousResearch/hermes-agent, shallow clone, commit 546146a7).

## 1. What Hermes is, in one picture

```
 Channels (Telegram/WhatsApp/Slack/API/cron)
        |
   Gateway  -- adapter -> MessageEvent -> authorize -> session key
        |
   AIAgent  -- sync loop: LLM call -> tool calls -> results -> repeat
        |               (system prompt is frozen for the whole session)
   Tools   -- terminal/file/browser run inside a SANDBOX (docker/modal/daytona/vercel/ssh)
        |      memory, todo, skills, delegate run in-process
   State   -- HERMES_HOME: config.yaml, .env, SOUL.md, skills/, MEMORY.md, state.db (SQLite+FTS5)
```

Two rules the maintainers apply to every change (`AGENTS.md`):
1. **Prompt caching is sacred.** The system prompt doesn't change mid-session. New context arrives
   as a user message or tool result. Context compression is the only allowed cache break.
2. **Narrow core, capability at the edges.** Every tool schema is sent on every call, so new
   abilities arrive as skills (markdown procedures) or plugins, not new core tools.

## 2. The parts that matter for you

| Concept | Hermes mechanism | Where to read |
|---|---|---|
| One deployment per customer | A **profile** = one `HERMES_HOME` dir (config, secrets, persona, skills, memory, DB). Docker image mounts it at `/opt/data`. | `hermes_cli/AGENTS.md` "Profiles", `Dockerfile`, `docker-compose.yml` |
| Many customers in one process | **Multiplex gateway**: contextvars + `secret_scope` fail-closed. | `website/docs/developer-guide/multiplexing-gateway.md` |
| Sandbox per agent | `_active_environments[key]` cache. The key is chosen in `_resolve_container_task_id`. Sandboxes are created lazily, reaped when idle, and torn down at exit. | `tools/terminal_tool.py:518`, `tools/terminal_tool_lifecycle.py` |
| Sandbox backend contract | `create_environment(task_id) -> env` with `execute(cmd)` and `cleanup()`; `strip_env_keys` keeps secrets out of model-run shells | `website/docs/developer-guide/terminal-environment-plugin.md` |
| Conversation routing | `build_session_key()` gives `<profile>:<platform>:<chat_type>:<chat_id>[:thread][:user]` | `gateway/session.py:700` |
| Agent loop | `while budget: call LLM; if tool_calls: run them; else return` | `agent/AGENTS.md`, `agent/conversation_loop.py`, `agent/turn_*.py` |
| Prompt layers | stable (SOUL.md persona) -> context (operator instructions) -> volatile (skills index, MEMORY.md, USER.md, time) | `website/docs/developer-guide/prompt-assembly.md` |
| Human-in-the-loop | Approval of dangerous actions, with a wait over the gateway channel | `tools/approval*.py` |
| Subagents | `delegate_task` runs a child agent that shares the parent's sandbox | `tools/delegate_tool*.py` |
| Scheduled work | Cron starts a fresh agent with no history, then delivers the result to a channel | `cron/AGENTS.md` |

### Caveat: Hermes does NOT give one sandbox per agent by default

- With Docker and `container_persistent: true` (the default), there is **one container per profile**,
  shared by every session.
- With `container_persistent: false`, there is **one container per session**. Subagents reuse the
  parent's container through an alias registry.
- Other backends get keys like `session:<key>`.

So "one sandbox per agent" is a config choice. To get it, set `container_persistent: false`, or key
the sandbox on your own agent-run id.

### Lesson: multiplexing is where the complexity lives

Most of Hermes's hardest code exists because one process serves many profiles. That code covers
profile-scope leaks, contextvar binding at thread hops, and secret-scope guards (see rules
HX002/HX004/HX005 in the docs). If you run **one container per hotel**, that whole class of bugs
disappears. Hermes supports that mode directly: one profile per container.

## 3. Proposed architecture for ONE hotel

```
                         +-------------------- Hotel deployment (1 container / 1 VM) --------------------+
 WhatsApp / Web chat --> | Gateway                                                                       |
 Email / Voice      -->  |   adapters -> normalize -> authorize (guest vs staff) -> session key          |
 PMS webhooks       -->  |                                                                               |
 Cron (pre-arrival) -->  | Session router: key = channel:guest_id  (staff: channel:staff_id)            |
                         |        |                                                                      |
                         |   Agent run (stateless worker, sync loop, per-session lease)                  |
                         |     prompt = SOUL(brand voice) + hotel facts + skills index + guest profile    |
                         |     tools:                                                                    |
                         |       host-side (hold creds): pms.lookup_booking, pms.modify, payments.refund, |
                         |                               housekeeping.ticket, notify_staff, memory        |
                         |       sandboxed: code/files/browser  -> Sandbox[agent_run_id]                   |
                         |     approval gate: refund > X, comp night, rate override -> staff channel      |
                         |        |                                                                      |
                         | State: hotel_home/ { config.yaml, .env, SOUL.md, skills/*.md (SOPs),          |
                         |                      state.db (sessions, messages, FTS), guests table }       |
                         +-------------------------------------------------------------------------------+
```

Design decisions, each based on Hermes:

1. **Deployment = hotel.** One container with one data volume per hotel. Do not multiplex
   (see the lesson above). Secrets go in `.env`; behaviour goes in `config.yaml`.
2. **Agent types are config, not code.** Use the same loop for every agent:
   - `concierge` serves guests. Its tools are limited and it has no shell.
   - `ops` serves staff. It has wider tools and the sandbox.
   - `cron` jobs handle pre-arrival messages, post-stay reviews, and the night audit summary.
     Each run is fresh, as in Hermes cron.
   A toolset per agent type mirrors Hermes `toolsets.py`.
3. **Sandbox per agent run.** Create it lazily on the first sandboxed tool call, keyed by
   `agent_run_id`. Subagents reuse the parent's sandbox. An idle reaper and teardown at exit clean
   up. Mirror the `create_environment / execute / cleanup` contract so the backend can be swapped
   (Docker locally, Vercel Sandbox / Modal / Daytona in the cloud).
4. **Credentials never enter the sandbox.** PMS, payment, and channel tokens live in host-side
   tools. The sandbox gets a stripped environment (Hermes `strip_env_keys`). This is the most
   important security property for a hotel.
5. **SOPs as skills.** Write `late_checkout.md`, `refund_policy.md`, and `lost_and_found.md` as
   markdown files. Only their index goes in the prompt, and the agent loads one on demand. Staff
   can edit them without a deploy.
6. **Memory has two levels.** Hotel facts go in the prompt's stable tier. Guest preferences go in a
   guests table keyed by guest id, loaded once at session start (Hermes `USER.md` pattern), and are
   never reloaded mid-session.
7. **Keep the prompt frozen per session.** Mid-conversation events such as "room is ready" arrive
   as a user message or tool result, never by rewriting the system prompt.
8. **Human approval for money and policy exceptions.** Send these through the staff channel with a
   timeout (`tools/approval_gateway_wait.py` pattern).
9. **Compression at about 50% of the context window.** Summarize old tool results first. Long guest
   stays need this.

## 4. Suggested reading order in the repo

1. `AGENTS.md`, then `website/docs/developer-guide/architecture.md`
2. `website/docs/developer-guide/agent-loop.md`, then `agent/conversation_loop.py`
3. `website/docs/developer-guide/prompt-assembly.md`
4. `website/docs/developer-guide/tools-runtime.md`, then `tools/registry.py`, `toolsets.py`
5. `website/docs/developer-guide/terminal-environment-plugin.md`, then `tools/terminal_tool.py` (around line 400-580), `tools/environments/docker.py`
6. `website/docs/developer-guide/gateway-internals.md`, then `gateway/session.py` (`build_session_key`)
7. `website/docs/developer-guide/session-storage.md`
8. Skim only: `multiplexing-gateway.md`, to see what you avoid by deploying one container per hotel

---

## 5. Deep dive: how sandboxed agents operate

**The agent loop never runs inside the sandbox.** The loop, LLM calls, and credentials stay in the
host (harness) process. Only tool *effects* run in the sandbox: `terminal`, `execute_code`, and the
file tools.

How a command runs (`tools/environments/base.py`):
1. The first sandboxed tool call creates the environment, keyed as described in section 2
   (`tools/terminal_tool.py` `_active_environments`).
2. `init_session()` captures a shell snapshot once: env vars, functions, aliases.
3. **Every command spawns a fresh `bash -c`.** The command re-sources the snapshot and `cd`s to the
   last cwd. The cwd is tracked with in-band stdout markers (remote) or a temp file (local). The
   result is a stateless exec that still feels like a persistent shell, and it survives
   reconnects.
4. It returns `{"output", "exit_code"}`. Output is drained by a thread, timeouts return partial
   output with exit code 124, and interrupts kill the process group.
5. File tools (`read_file`, `write_file`, `patch`) go through the same `execute()`, so they see
   exactly what the shell sees.
6. Lifecycle: an idle reaper stops sandboxes nobody is using, `cleanup()` runs at session end, and
   an atexit hook kills orphans. `reap_orphan_containers()` cleans up after crashes.

Docker hardening (`tools/environments/docker.py:328`):
- `--cap-drop ALL`, `no-new-privileges`, and a PID limit.
- tmpfs `/tmp` and `/var/tmp`, both `nosuid`.
- CPU, memory, and disk limits.
- Skills mounted read-only.
- An optional egress proxy (`docker_egress.py`).
- Secrets removed with `strip_env_keys`. Only named env vars are forwarded.

**Hotel takeaway:** keep the loop and credentials on the host and send only code and files into
the sandbox. Use one sandbox per agent run, created lazily. Run a fresh process per command so the
sandbox can be killed or restarted at any time without losing the conversation.

## 6. Deep dive: self-improving agents

Hermes improves itself through **files, not weights**. There are three mechanisms:

| Mechanism | Trigger | What it does | Code |
|---|---|---|---|
| Background review | Every N user turns (memory, default 10) / N tool iterations (skills, default 10) | **Forks** the agent in a daemon thread. The fork replays the conversation and asks "should a memory or skill be saved or updated?", then writes through the `memory` and `skill_manage` tools under a tool whitelist. The main conversation and prompt cache are untouched, and the fork reuses the same cached prefix, so it is cheap. | `agent/background_review.py` (prompts at ~line 370-560) |
| In-turn skill writing | The agent decides during the task | The `skill_manage` tool creates or patches `skills/<cat>/<name>/SKILL.md` plus `references/` and `scripts/`. | `tools/skill_manager_tool.py` |
| Curator | When the agent is idle and the last run is older than 7 days | Marks skills stale after 14 days and archives them after 30. Archiving is recoverable; it never deletes. Pinned skills are exempt. An optional LLM fork consolidates duplicates. | `agent/curator.py` |

Strong signals the review prompt looks for:
- The user corrected tone, format, or workflow ("stop doing X").
- A non-trivial fix or technique emerged.
- A skill loaded this session turned out wrong or outdated. That one gets patched immediately.

Preference order: patch a skill that is already loaded, then extend an existing class-level skill,
then create a new one.

Guardrails:
- `skills_guard.scan_skill` scans for injection and exfiltration.
- Read-before-write and delete guards apply to background writes.
- Skill descriptions are capped at 60 characters, so the index stays small in the prompt.

**Hotel takeaway:** this suits a hotel well.
- A guest says "don't call, message me", which goes to that guest's profile.
- Staff correct the agent ("late checkout is free for Gold members"). The agent patches
  `late_checkout.md`.
- Route skill edits from guest-facing sessions to a **staff approval queue** before they go live.
  Hermes already stages writes for approval (`_pin_matched_entries` in `tools/memory_tool.py`).
  Never let a guest's words rewrite hotel policy directly.

## 7. Deep dive: agent memory via files

There are three tiers. All are plain files or SQLite under `HERMES_HOME`:

| Tier | Storage | Size | How it's used |
|---|---|---|---|
| Declarative (environment facts) | `memories/MEMORY.md` | ~2,200 chars | In the system prompt as a **frozen snapshot** |
| Declarative (who the user is) | `memories/USER.md` | ~1,375 chars | Same, frozen snapshot |
| Procedural (how to do X) | `skills/**/SKILL.md` | Unbounded, but only a 60-char index line each is in the prompt | Loaded on demand with `skill_view` |
| Episodic (what happened) | `state.db` SQLite + FTS5 | Unbounded | The `session_search` tool recalls past conversations |

How the memory files work (`tools/memory_tool_store.py`):
- **Entries are separated by `\n§\n`.** Operations are `add`, `patch` (old_text must match one
  unique entry), `remove`, and `batch`.
- **Hard character caps.** A write over the cap is refused with "free at least N chars". This
  forces the agent to consolidate instead of hoarding.
- **Frozen snapshot.** Files are loaded at session start. Writes during the session go to disk
  immediately but don't change the prompt until the next session (the prompt-caching invariant).
- File locks (`fcntl`) handle concurrent writers, and writes are atomic.
- Every write is scanned for injection and exfiltration patterns, because memory lands in the
  system prompt and a poisoned entry would persist across sessions.
- **Routing rule:** one fact goes in one store, never both.

**Hotel takeaway:** map the tiers like this.
- Hotel facts (wifi, breakfast hours, quirks) go in `MEMORY.md`, or better, a hotel facts file
  edited by staff.
- Guest preferences go in a **per-guest** `USER.md`, keyed by guest id. Hermes has one `USER.md`
  per profile because it serves one person, and a hotel has thousands of guests. Load the right
  guest's file at session start.
- SOPs go in skills.
- Past stays and conversations go in the session DB with FTS search.
- Keep the hard caps and the injection scan. Guest-supplied text is untrusted input.
