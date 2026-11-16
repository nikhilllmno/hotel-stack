"""Hotel-core MCP for Doss: read-only tools over hotel core's API (calls, texts, payments, team messages, evals,
Danny's published versions, Vapi sync, core health). Bookings and prices stay in the Beds24 MCP; agent files are in
Doss's sandbox at /repo.

Every tool is readOnlyHint: reading never changes anything, and the proposal tools only create a pending change.
The owner approves (or rejects) each change on the dashboard's Pending changes page; Doss's key can never approve
(core answers 403), so nothing Doss does here goes live by itself.

Run (Hermes starts it): uv run --directory <hotel-stack> python -m hotelcore.doss_mcp
Env (from hotel-stack/.env): CORE_API_URL, DOSS_API_KEY.
"""

import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from hotelcore.baml_client.types import FileEdit, GuestText

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

mcp = MCPServer("hotel")
READ_ONLY = ToolAnnotations(readOnlyHint=True)
SMALL_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)  # Hermes asks the owner in the chat


def core(path: str, body: dict | None = None, **params) -> dict | list:
    """GET (or POST with body) to hotel core with Doss's key. Errors surface as readable messages to the model."""
    with httpx.Client(base_url=os.environ.get("CORE_API_URL", "http://127.0.0.1:8000"), timeout=300,
                      headers={"x-dashboard-key": os.environ["DOSS_API_KEY"]}) as http:
        query = {k: v for k, v in params.items() if v not in (None, "")}
        r = http.post(path, json=body, params=query) if body is not None else http.get(path, params=query)
    if r.status_code >= 400:
        raise RuntimeError(f"hotel core {r.status_code} on {path}: {r.text[:300]}")
    return r.json()


@mcp.tool(annotations=READ_ONLY)
def agent_overview() -> dict:
    """Start here before answering about, or changing, Danny. A plain-language map of the guest agent: what he can do
    (on calls and texts), every text he can send (with a real example), his instruction files and their sections, KB
    topics, rules, all facts with current values, his test scenarios, voice settings, and where each kind of change
    goes. The owner speaks plainly ("text them the booking link"); use this to find the internal names and files
    yourself, never ask the owner for them."""
    return core("/api/agents/overview")


@mcp.tool(annotations=READ_ONLY)
def call_stats(days: int = 7) -> dict:
    """Danny's phone calls over the last N days: counts, duration, bookings made, booking revenue, call cost,
    breakdown by caller intent and outcome, and how many team messages are open."""
    return core("/api/stats", days=days)


@mcp.tool(annotations=READ_ONLY)
def list_calls(days: int = 7, intent: str = "", search: str = "", limit: int = 50) -> list:
    """Calls (newest first) with time, caller number, intent, outcome, sentiment, summary, booking made and cost.
    intent: new_booking, existing_booking, modify_booking, cancel_booking, question, complaint, other.
    search matches caller number, summary or transcript."""
    return core("/api/calls", days=days, intent=intent, q=search, limit=limit)


@mcp.tool(annotations=READ_ONLY)
def get_call(call_id: str) -> dict:
    """One call in full: transcript, every tool Danny called (arguments, ok/error, ms), team messages it created,
    recording URL. Use list_calls first to find the id."""
    call = core(f"/api/calls/{call_id}")
    call.pop("messages", None)  # Vapi's turn-by-turn copy of the transcript: same content, many more tokens
    return call


@mcp.tool(annotations=READ_ONLY)
def list_text_threads(days: int = 30) -> list:
    """SMS conversations Danny handled (one row per guest phone): last message, time, message count."""
    return core("/api/sms", days=days)


@mcp.tool(annotations=READ_ONLY)
def get_text_thread(phone: str) -> list:
    """All texts with one guest phone (international format, e.g. +18305551234), oldest first, with the tools
    Danny used for each reply (send_text, create_reservation, ...)."""
    return core(f"/api/sms/{phone}")


@mcp.tool(annotations=READ_ONLY)
def list_payments(days: int = 30, status: str = "") -> list:
    """Deposit payment links sent to guests (demo provider): booking id, guest phone, amount, status
    (open | paid | expired), created/expires/paid times. An open link past expires_at shows expired=true.
    Unpaid deposits = open links; cross-check the booking in Beds24 (status request = not yet confirmed)."""
    return core("/api/payments", days=days, status=status)


@mcp.tool(annotations=READ_ONLY)
def list_team_messages(status: str = "open") -> list:
    """Callback requests Danny took for the team (take_message): guest, callback number, reason, call id.
    status: open or done."""
    return core("/api/messages", status=status)


@mcp.tool(annotations=READ_ONLY)
def list_eval_runs(limit: int = 10) -> list:
    """Recent eval runs of Danny (scripted guest conversations graded by a judge): id, time, total, passed."""
    return core("/api/evals", limit=limit)


@mcp.tool(annotations=READ_ONLY)
def get_eval_run(run_id: int) -> dict:
    """One eval run: failing scenarios in full (transcript + judge reason), passing ones by name only."""
    run = core(f"/api/evals/{run_id}")
    results = run.pop("results", [])
    run["failed"] = [r for r in results if not r.get("passed")]
    run["passed_names"] = [r["name"] for r in results if r.get("passed")]
    return run


@mcp.tool(annotations=READ_ONLY)
def list_versions() -> list:
    """Every publish of Danny's voice agent (newest first): version id, time, author, note. The first is live."""
    return core("/api/versions")


@mcp.tool(annotations=READ_ONLY)
def get_version_diff(version_id: int) -> dict:
    """What changed in one published version, as a unified diff per file against the previous version."""
    return core(f"/api/versions/{version_id}/diff")


@mcp.tool(annotations=READ_ONLY)
def vapi_sync() -> dict:
    """Is live Vapi identical to the last repo publish? Lists problems (UI drafts, live changes) if not."""
    return core("/api/vapi/drift")


@mcp.tool(annotations=READ_ONLY)
def core_health() -> dict:
    """Hotel core status: when it started, open team messages, last eval run, payment link counts, last call time,
    and the most recent warnings/errors from the core log."""
    return core("/api/health")


PROPOSED = ("Proposed as change #{id} ({status}). Checks are running ({areas}); the owner reviews the diff and "
            "approves it on the dashboard's Pending changes page. Nothing is live until then. "
            "Use get_change({id}) to see the check results.")


@mcp.tool(annotations=READ_ONLY)
def draft_change(request: str, paths: list[str]) -> dict:
    """Propose a change from a plain request; core drafts the exact edits (BAML DraftChange) from the current
    contents of `paths` (repo-relative, e.g. hotels/contigo-ranch/kb/amenities.md). Good for wording, KB, facts and
    template changes. Nothing goes live until the owner approves it."""
    out = core("/api/changes", {"request": request, "paths": paths})
    return {**out, "next": PROPOSED.format(id=out["id"], status=out["status"], areas=", ".join(out["areas"]))}


@mcp.tool(annotations=READ_ONLY)
def propose_change(title: str, reason: str, edits: list[FileEdit]) -> dict:
    """Propose exact edits (typically code you wrote and tested in your sandbox copy of /repo). Each edit: path plus
    either old_text/new_text (old_text must appear exactly once), content (whole file) or delete. Allowed paths:
    hotels/, src/, tests/, db/migrations/, dashboard/src/, baml_src/, pyproject.toml, dashboard/package.json.
    Never .env or secrets. Nothing goes live until the owner approves it."""
    body = {"proposal": {"title": title, "reason": reason, "edits": [e.model_dump(exclude_none=True) for e in edits]}}
    out = core("/api/changes", body)
    return {**out, "next": PROPOSED.format(id=out["id"], status=out["status"], areas=", ".join(out["areas"]))}


@mcp.tool(annotations=READ_ONLY)
def propose_rollback(version_id: int) -> dict:
    """Propose restoring Danny's hotel files exactly as published in an earlier version (see list_versions).
    Shows as a normal change with a diff; goes live only when the owner approves it."""
    out = core("/api/changes", {"rollback_version": version_id})
    return {**out, "next": PROPOSED.format(id=out["id"], status=out["status"], areas=", ".join(out["areas"]))}


@mcp.tool(annotations=READ_ONLY)
def propose_guest_texts(reason: str, items: list[GuestText], send_at: str = "") -> dict:
    """Propose texts to one or more guests (up to 50). Per recipient: `to` (+1... international), optional `name`,
    and EITHER `text_name` (a hotel text from agent_overview, e.g. payment_link with booking_id, directions,
    booking_link) OR `body` (your own short wording, signed as the hotel). Core renders the exact message for each
    guest now; the owner sees every recipient and message and approves before anything is sent. send_at: hotel time
    'YYYY-MM-DD HH:MM' to schedule (the owner can cancel until then); empty = send when approved. Texts cannot be
    unsent. Find guests' numbers in Beds24 (phone / mobile on the booking) or from the owner."""
    out = core("/api/changes", {"guest_texts": {"reason": reason, "send_at": send_at or None,
                                                "items": [i.model_dump(exclude_none=True) for i in items]}})
    when = f"at {out['send_at']}" if out.get("send_at") else "as soon as the owner approves"
    return {**out, "next": f"Proposed as change #{out['id']}: {out['recipients']} text(s), to be sent {when}. "
                           "Nothing is sent until the owner approves it on Pending changes."}


@mcp.tool(annotations=READ_ONLY)
def propose_mini_app(slug: str, title: str, description: str, html: str, for_guests: bool = False) -> dict:
    """Propose a new mini app, or a new version of one (same slug). One self-contained HTML document, inline CSS/JS,
    no external scripts. Owner app (for_guests false): shown in the dashboard; data via window.hotel.get(path, params)
    and buttons via window.hotel.act(type, payload) (see the mini-apps skill). Public page (for_guests true): served
    at /p/<slug>; window.hotel.get("availability" | "info", params) only. The owner sees the HTML diff and approves."""
    out = core("/api/changes", {"mini_app": {"slug": slug, "title": title, "description": description, "html": html,
                                             "for_guests": for_guests}})
    return {**out, "next": f"Proposed as change #{out['id']}. It goes live when the owner approves it on Pending changes."}


@mcp.tool(annotations=READ_ONLY)
def list_mini_apps() -> list:
    """Mini apps that are live: slug, title, description, public or owner-only, version."""
    return core("/api/apps")


@mcp.tool(annotations=READ_ONLY)
def get_mini_app(slug: str) -> dict:
    """One live mini app including its current HTML (start from this when changing it)."""
    return core(f"/api/apps/{slug}")


@mcp.tool(annotations=READ_ONLY)
def list_changes(status: str = "", limit: int = 20) -> list:
    """Changes (newest first): id, title, status (checking | ready | failed | applied | rejected | undone), areas,
    files, the review summary and risk, who decided."""
    return core("/api/changes", status=status, limit=limit)


@mcp.tool(annotations=READ_ONLY)
def get_change(change_id: int) -> dict:
    """One change: status, every check's result (render, evals with failures, tests, build), the review, and the
    unified diff per file."""
    import difflib
    c = core(f"/api/changes/{change_id}")
    c["diff"] = {f["path"]: "\n".join(difflib.unified_diff((f["before"] or "").splitlines(), (f["after"] or "").splitlines(),
                                                          f"a/{f['path']}", f"b/{f['path']}", lineterm="")) for f in c.pop("files")}
    c.pop("proposal", None)
    return c


@mcp.tool(annotations=READ_ONLY)
def unanswered_questions(days: int = 7) -> dict:
    """Where Danny fell short in the last N days: KB topics he searched for that don't exist (with call ids), callback
    requests he took instead of answering, and calls that ended with a message taken, abandoned or quoted without a
    booking (with summaries). Use with get_call / get_text_thread to find what guests actually asked."""
    return core("/api/insights/unanswered", days=days)


@mcp.tool(annotations=READ_ONLY)
def post_report(title: str, markdown: str, kind: str = "report") -> dict:
    """Publish a report to the owner's Reports page (shown unread in the dashboard). Informational only: it changes
    nothing, so scheduled jobs can post without approval. Markdown: short headings, bullets, small tables; numbers
    and names first. kind: a short label like daily-summary, kb-gaps, deposits, arrivals."""
    return core("/api/reports", {"title": title, "body": markdown, "kind": kind})


@mcp.tool(annotations=READ_ONLY)
def list_reports(limit: int = 20, kind: str = "") -> dict:
    """Reports already posted (newest first, with a preview) and how many the owner hasn't read."""
    return core("/api/reports", limit=limit, kind=kind)


@mcp.tool(annotations=SMALL_WRITE)
def mark_team_message_done(message_id: int) -> dict:
    """Close a callback request (from list_team_messages) once the team has handled it."""
    return core(f"/api/messages/{message_id}/done", {})


@mcp.tool(annotations=SMALL_WRITE)
def run_danny_tests(channel: str = "voice") -> dict:
    """Run Danny's test conversations now (channel: voice for calls, text for texts). Takes 1-2 minutes and a few
    dollars of model usage; then use list_eval_runs / get_eval_run for the result."""
    return core("/api/evals/run", {}, channel=channel)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
