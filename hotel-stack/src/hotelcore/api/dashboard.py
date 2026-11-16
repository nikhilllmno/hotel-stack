"""Read API for the dashboard and Doss: calls, stats, bookings, texts, payments, evals, versions, health.

Header x-dashboard-key: the dashboard's key (owner) or Doss's key (DOSS_API_KEY). Doss may read everything and start
evals; owner-only actions (rollback, and later approvals) refuse Doss's key with 403.
"""

import difflib
import hmac
import os
import threading
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from hotelcore.tools.reservations import ALL_STATUSES
from hotelcore.tools.rooms import room_types


def caller(x_dashboard_key: str = Header(default="")) -> str:
    """'owner' for the dashboard's key, 'doss' for Doss's key; anything else is refused."""
    if hmac.compare_digest(x_dashboard_key, os.environ["DASHBOARD_API_KEY"]):
        return "owner"
    doss_key = os.environ.get("DOSS_API_KEY", "")
    if doss_key and hmac.compare_digest(x_dashboard_key, doss_key):
        return "doss"
    raise HTTPException(status_code=401, detail="bad dashboard key")


def require_owner(who: str = Depends(caller)) -> None:
    if who != "owner":
        raise HTTPException(status_code=403, detail="owner only: Doss can propose this, the owner approves it")


router = APIRouter(prefix="/api", dependencies=[Depends(caller)])
CALL_FIELDS = "id, started_at, duration_s, caller_phone, intent, outcome, sentiment, summary, booking_id, booking_amount, cost_usd"


def ctx(request: Request):
    return request.app.state.ctx


@router.get("/stats")
def stats(request: Request, days: int = 7):
    with ctx(request).db.connection() as conn:
        totals = conn.execute(
            "select count(*) calls, coalesce(sum(duration_s),0) duration_s, count(booking_id) bookings, "
            "coalesce(sum(booking_amount),0) booking_revenue, coalesce(sum(cost_usd),0) cost_usd "
            "from calls where started_at > now() - make_interval(days => %s)", (days,)).fetchone()
        intents = conn.execute(
            "select coalesce(intent,'unanalyzed') intent, count(*) n from calls "
            "where started_at > now() - make_interval(days => %s) group by 1 order by 2 desc", (days,)).fetchall()
        outcomes = conn.execute(
            "select coalesce(outcome,'unanalyzed') outcome, count(*) n from calls "
            "where started_at > now() - make_interval(days => %s) group by 1 order by 2 desc", (days,)).fetchall()
        messages = conn.execute("select count(*) n from team_messages where status = 'open'").fetchone()["n"]
    return {"days": days, **totals, "intents": intents, "outcomes": outcomes, "open_messages": messages}


@router.get("/calls")
def calls(request: Request, days: int = 7, intent: str = "", q: str = "", limit: int = 100):
    sql = f"select {CALL_FIELDS} from calls where started_at > now() - make_interval(days => %(days)s)"
    if intent:
        sql += " and intent = %(intent)s"
    if q:
        sql += " and (caller_phone ilike %(q)s or summary ilike %(q)s or transcript ilike %(q)s)"
    with ctx(request).db.connection() as conn:
        return conn.execute(sql + " order by started_at desc limit %(limit)s",
                            {"days": days, "intent": intent, "q": f"%{q}%", "limit": limit}).fetchall()


@router.get("/calls/{call_id}")
def call_detail(request: Request, call_id: str):
    with ctx(request).db.connection() as conn:
        call = conn.execute(f"select {CALL_FIELDS}, ended_at, ended_reason, recording_url, transcript, messages "
                            "from calls where id = %s", (call_id,)).fetchone()
        if call is None:
            raise HTTPException(404, "no such call")
        call["tool_calls"] = conn.execute("select name, arguments, ok, error, ms, created_at from tool_calls "
                                          "where call_id = %s order by id", (call_id,)).fetchall()
        call["team_messages"] = conn.execute("select id, guest_name, callback_phone, reason, status from team_messages "
                                             "where call_id = %s", (call_id,)).fetchall()
    return call


@router.get("/messages")
def messages(request: Request, status: str = "open"):
    with ctx(request).db.connection() as conn:
        return conn.execute("select * from team_messages where status = %s order by created_at desc", (status,)).fetchall()


@router.post("/messages/{message_id}/done")
def message_done(request: Request, message_id: int, note: str = ""):
    """Close a callback request once the team has handled it."""
    with ctx(request).db.connection() as conn:
        row = conn.execute("update team_messages set status = 'done' where id = %s and status = 'open' returning id, reason",
                           (message_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no open team message with that id")
    return {"done": True, **row}


@router.get("/bookings")
def bookings(request: Request, days: int = 30):
    c = ctx(request)
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = c.pms.get_all("/bookings", propertyId=c.pms.property_id, status=ALL_STATUSES, bookingTimeFrom=since)
    with c.db.connection() as conn:
        by_danny = {r["booking_id"] for r in conn.execute("select booking_id from calls where booking_id is not null")}
    rooms = room_types(c)
    items = [{
        "id": b["id"], "guest": f"{b.get('firstName', '')} {b.get('lastName', '')}".strip(), "channel": b.get("channel") or "direct",
        "booked_at": b.get("bookingTime"), "arrival": b.get("arrival"), "departure": b.get("departure"),
        "room": rooms.get(b.get("roomId"), {}).get("name"), "status": b.get("status"), "total": b.get("price") or 0,
        "deposit": b.get("deposit") or 0, "by_danny": b["id"] in by_danny,
    } for b in rows]
    live = [i for i in items if i["status"] != "cancelled"]
    return {"days": days, "revenue": sum(i["total"] for i in live), "collected": sum(i["deposit"] for i in live),
            "new_bookings": len(live), "by_danny": sum(i["by_danny"] for i in live),
            "items": sorted(items, key=lambda i: i["booked_at"] or "", reverse=True)}


@router.get("/evals")
def eval_runs(request: Request, limit: int = 20):
    with ctx(request).db.connection() as conn:
        return conn.execute("select id, started_at, total, passed from eval_runs order by id desc limit %s", (limit,)).fetchall()


@router.get("/evals/{run_id}")
def eval_run(request: Request, run_id: int):
    with ctx(request).db.connection() as conn:
        row = conn.execute("select * from eval_runs where id = %s", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no such eval run")
    return row


@router.post("/evals/run", status_code=202)
def start_evals(request: Request, channel: str = "voice"):
    """Runs in the background (~1-2 min); poll GET /api/evals for the new run. channel: voice | text."""
    from hotelcore.evals import run, save
    if channel not in ("voice", "text"):
        raise HTTPException(400, "channel must be voice or text")
    hotel = ctx(request).hotel
    threading.Thread(target=lambda: save(run(hotel, channel=channel)), daemon=True).start()
    return {"started": True, "channel": channel}


@router.get("/versions")
def versions(request: Request):
    with ctx(request).db.connection() as conn:
        return conn.execute("select id, created_at, author, note from config_versions order by id desc").fetchall()


@router.get("/versions/{version_id}/diff")
def version_diff(request: Request, version_id: int):
    """Unified diff of this version against the previous one, per file."""
    with ctx(request).db.connection() as conn:
        rows = conn.execute("select id, files from config_versions where id <= %s order by id desc limit 2",
                            (version_id,)).fetchall()
    if not rows or rows[0]["id"] != version_id:
        raise HTTPException(404, "no such version")
    new, old = rows[0]["files"], rows[1]["files"] if len(rows) > 1 else {}
    diffs = {}
    for path in sorted(set(new) | set(old)):
        lines = list(difflib.unified_diff(old.get(path, "").splitlines(), new.get(path, "").splitlines(),
                                          f"a/{path}", f"b/{path}", lineterm=""))
        if lines:
            diffs[path] = "\n".join(lines)
    return {"version": version_id, "against": rows[1]["id"] if len(rows) > 1 else None, "files": diffs}


@router.post("/versions/{version_id}/rollback", dependencies=[Depends(require_owner)])
def rollback(version_id: int, author: str = "dashboard"):
    """Restore a version's files and publish them as a new version (same path as the CLI)."""
    import subprocess
    import sys
    from hotelcore.api.app import REPO
    done = subprocess.run([sys.executable, "-m", "hotelcore.publish", "--rollback", str(version_id), "--author", author],
                          cwd=REPO, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise HTTPException(500, done.stderr.strip()[-500:] or "rollback failed")
    return {"ok": True, "output": done.stdout.strip().splitlines()[-1]}


@router.get("/vapi/drift")
def vapi_drift(request: Request):
    """Is live Vapi (or a Vapi UI draft) different from the last repo publish? Empty list = in sync."""
    import yaml
    from hotelcore.publish import drift, find_assistant, vapi_client
    hotel = ctx(request).hotel
    name = yaml.safe_load((hotel.root / "voice.yaml").read_text())["assistant_name"]
    with ctx(request).db.connection() as conn:
        last = conn.execute("select assistant from config_versions order by id desc limit 1").fetchone()
    with vapi_client() as vapi:
        live = find_assistant(vapi, name)
        problems = drift(vapi, live, last["assistant"] if last else None) if live else ["assistant not found in Vapi"]
    return {"in_sync": not problems, "problems": problems}


@router.get("/sms")
def sms_threads(request: Request, days: int = 30):
    """One row per guest thread: last message, counts."""
    with ctx(request).db.connection() as conn:
        return conn.execute(
            "select guest_phone, max(created_at) last_at, count(*) messages, "
            "(array_agg(body order by created_at desc))[1] last_body "
            "from text_messages where created_at > now() - make_interval(days => %s) "
            "group by guest_phone order by last_at desc", (days,)).fetchall()


@router.get("/sms/{phone}")
def sms_thread(request: Request, phone: str):
    with ctx(request).db.connection() as conn:
        return conn.execute("select created_at, direction, body, tools from text_messages where guest_phone = %s "
                            "order by created_at", (phone,)).fetchall()


@router.get("/payments")
def payments(request: Request, days: int = 30, status: str = ""):
    """Deposit payment links (demo provider today): open, paid or expired, newest first."""
    sql = ("select token, booking_id, guest_phone, amount, currency, provider, status, created_at, expires_at, paid_at, "
           "(status = 'open' and expires_at < now()) as expired from payments "
           "where created_at > now() - make_interval(days => %(days)s)")
    if status:
        sql += " and status = %(status)s"
    with ctx(request).db.connection() as conn:
        return conn.execute(sql + " order by created_at desc", {"days": days, "status": status}).fetchall()


@router.get("/health")
def health_details(request: Request):
    """Core status for Doss: uptime, open team messages, last eval run, payment counts, recent warnings/errors."""
    from hotelcore.api.app import STARTED_AT, recent_log_lines
    with ctx(request).db.connection() as conn:
        open_messages = conn.execute("select count(*) n from team_messages where status = 'open'").fetchone()["n"]
        last_eval = conn.execute("select id, started_at, total, passed from eval_runs order by id desc limit 1").fetchone()
        pays = conn.execute("select status, count(*) n from payments group by status").fetchall()
        last_call = conn.execute("select max(started_at) at from calls").fetchone()["at"]
    return {"core_started_at": STARTED_AT, "open_team_messages": open_messages, "last_eval_run": last_eval,
            "payments_by_status": {p["status"]: p["n"] for p in pays}, "last_call_at": last_call,
            "recent_warnings_and_errors": recent_log_lines()}


@router.get("/agents/overview")
def agents_overview(request: Request):
    """Plain-language map of Danny (abilities, texts, instructions, KB, facts, tests, voice) for Doss."""
    from hotelcore.overview import agent_overview
    return agent_overview(ctx(request).hotel)
