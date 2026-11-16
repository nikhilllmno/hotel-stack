"""Reports (written by Doss, read by the owner) and insights Doss builds them from."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from hotelcore.api.dashboard import caller, ctx, require_owner

router = APIRouter(prefix="/api", dependencies=[Depends(caller)])


class ReportBody(BaseModel):
    title: str
    body: str
    kind: str = "report"


@router.get("/reports")
def list_reports(request: Request, limit: int = 50, kind: str = ""):
    sql = "select id, title, kind, created_at, read_at, left(body, 240) as preview from reports"
    params: dict = {"limit": limit}
    if kind:
        sql += " where kind = %(kind)s"
        params["kind"] = kind
    with ctx(request).db.connection() as conn:
        rows = conn.execute(sql + " order by created_at desc limit %(limit)s", params).fetchall()
        unread = conn.execute("select count(*) n from reports where read_at is null").fetchone()["n"]
    return {"unread": unread, "reports": rows}


@router.get("/reports/{report_id}")
def get_report(request: Request, report_id: int):
    with ctx(request).db.connection() as conn:
        row = conn.execute("select * from reports where id = %s", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no such report")
    return row


@router.post("/reports", status_code=201)
def post_report(request: Request, body: ReportBody):
    """Doss (or the owner) adds a report; it appears unread on the dashboard."""
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(400, "title and body are required")
    with ctx(request).db.connection() as conn:
        row = conn.execute("insert into reports (title, body, kind) values (%s, %s, %s) returning id, created_at",
                           (body.title.strip(), body.body.strip(), body.kind.strip() or "report")).fetchone()
    return row


@router.post("/reports/{report_id}/read", dependencies=[Depends(require_owner)])
def mark_read(request: Request, report_id: int):
    with ctx(request).db.connection() as conn:
        conn.execute("update reports set read_at = coalesce(read_at, now()) where id = %s", (report_id,))
    return {"ok": True}


@router.get("/insights/unanswered")
def unanswered(request: Request, days: int = 7):
    """Where Danny fell short: KB topics he looked for that don't exist, callback requests he took, and calls that
    ended with a message taken or abandoned (with summaries). Raw material for KB-gap reports."""
    with ctx(request).db.connection() as conn:
        topics = conn.execute(
            "select topic, count(*) n, array_agg(distinct call_id) filter (where call_id is not null) call_ids "
            "from tool_calls, jsonb_array_elements_text(result->'unknown_topics') topic "
            "where name = 'search_knowledge_base' and created_at > now() - make_interval(days => %s) "
            "group by topic order by n desc", (days,)).fetchall()
        messages = conn.execute(
            "select id, created_at, channel, guest_name, reason, status from team_messages "
            "where created_at > now() - make_interval(days => %s) order by created_at desc", (days,)).fetchall()
        calls = conn.execute(
            "select id, started_at, intent, outcome, summary from calls where started_at > now() - make_interval(days => %s) "
            "and outcome in ('message_taken', 'abandoned', 'quoted_no_booking') order by started_at desc", (days,)).fetchall()
    return {"days": days, "unknown_kb_topics": topics, "team_messages": messages, "calls_needing_follow_up": calls}
