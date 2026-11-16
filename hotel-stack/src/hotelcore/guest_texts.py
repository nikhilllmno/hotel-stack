"""Texts to guests that Doss proposes (owner decisions: every text needs approval; any recipients the owner names;
optional send time; no built-in quiet hours).

Doss proposes a BAML GuestTextBatch. Core renders the EXACT message for every recipient now (hotel templates through
sms.compose, or Doss's own wording), so the owner approves precisely what each guest will receive. Approve sends at
once, or marks the change `scheduled` and the scheduler sends it at send_at. Texts cannot be unsent, so no undo.
"""

import asyncio
import logging
import re
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from hotelcore.tools.context import ToolContext, ToolError  # first: loads the tools package before sms/payments (import cycle)
from hotelcore.baml_client.types import GuestTextBatch  # noqa: E402
from hotelcore.changes import ProposalError, get  # noqa: E402
from hotelcore.payments import LINK_HOURS  # noqa: E402
from hotelcore.sms import compose, deliver  # noqa: E402

log = logging.getLogger(__name__)
PHONE = re.compile(r"^\+[1-9]\d{7,14}$")
MAX_RECIPIENTS = 50


def parse_send_at(value: str | None, tz: str, now: datetime | None = None) -> datetime | None:
    """'YYYY-MM-DD HH:MM' in hotel time, or ISO with an offset. None = send when approved."""
    if not value or not value.strip():
        return None
    try:
        at = datetime.fromisoformat(value.strip())
    except ValueError:
        raise ProposalError(f"send_at {value!r}: use 'YYYY-MM-DD HH:MM' in hotel time")
    if at.tzinfo is None:
        at = at.replace(tzinfo=ZoneInfo(tz))
    if at < (now or datetime.now(timezone.utc)) - timedelta(minutes=5):
        raise ProposalError(f"send_at {value} is in the past")
    return at


def render_items(ctx: ToolContext, batch: GuestTextBatch, send_at: datetime | None) -> list[dict]:
    """The exact text each recipient gets. Raises ProposalError for a bad number, a duplicate or an unknown text."""
    if not batch.items:
        raise ProposalError("no recipients")
    if len(batch.items) > MAX_RECIPIENTS:
        raise ProposalError(f"{len(batch.items)} recipients; at most {MAX_RECIPIENTS} per batch, split it")
    ctx = replace(ctx, channel="doss")  # payment links made here are not tied to a phone call
    items, seen = [], set()
    for it in batch.items:
        to = re.sub(r"[\s().-]", "", it.to)
        if not PHONE.match(to):
            raise ProposalError(f"{it.to}: not a mobile number in international format like +18305551234")
        if to in seen:
            raise ProposalError(f"{to} is listed twice")
        seen.add(to)
        if it.text_name:
            try:
                body = compose(ctx, it.text_name, it.booking_id, to)
            except ToolError as e:
                raise ProposalError(f"{to}: {e}")
        elif it.body and it.body.strip():
            body = it.body.strip()
        else:
            raise ProposalError(f"{to}: give either a hotel text (text_name) or custom wording (body)")
        if "/pay/" in body and send_at and send_at > datetime.now(timezone.utc) + timedelta(hours=LINK_HOURS - 4):
            raise ProposalError("payment links expire after 24 hours; schedule payment-link texts within 20 hours")
        items.append({"to": to, "name": it.name, "text_name": it.text_name, "booking_id": it.booking_id, "body": body})
    return items


def propose(ctx: ToolContext, batch: GuestTextBatch, created_by: str) -> dict:
    tz = ctx.hotel.facts["property"]["time_zone"]
    send_at = parse_send_at(batch.send_at, tz)
    items = render_items(ctx, batch, send_at)
    title = f"Text {len(items)} guest{'s' if len(items) != 1 else ''}" + (f" at {send_at.astimezone(ZoneInfo(tz)):%a %b %d, %I:%M %p}" if send_at else "")
    with ctx.db.connection() as conn:
        row = conn.execute(
            "insert into changes (kind, title, reason, proposal, areas, status, created_by, send_at) "
            "values ('guest_texts', %s, %s, %s, '[\"guest_texts\"]', 'ready', %s, %s) returning id",
            (title, batch.reason, Jsonb({"batch": batch.model_dump(mode="json"), "items": items}), created_by, send_at)).fetchone()
    return {"id": row["id"], "status": "ready", "title": title, "recipients": len(items),
            "send_at": send_at.isoformat() if send_at else None, "items": items}


def send(ctx: ToolContext, change: dict) -> list[dict]:
    """Send every item; one failure (opted out, landline) never stops the rest."""
    return [{"to": it["to"], "name": it.get("name"), **deliver(ctx, it["to"], it["body"], f"doss_text:change#{change['id']}")}
            for it in change["proposal"]["items"]]


def claim(ctx: ToolContext, change_id: int, from_status: str) -> dict | None:
    """Atomically move a change to `sending` so it is sent exactly once (scheduler and approve never race)."""
    with ctx.db.connection() as conn:
        return conn.execute("update changes set status = 'sending' where id = %s and status = %s returning *",
                            (change_id, from_status)).fetchone()


def finish(ctx: ToolContext, change_id: int, results: list[dict]) -> None:
    with ctx.db.connection() as conn:
        conn.execute("update changes set status = 'applied', sent = %s where id = %s", (Jsonb(results), change_id))


def approve(ctx: ToolContext, change_id: int, decided_by: str) -> dict:
    c = get(ctx.db, change_id)
    if c["kind"] != "guest_texts" or c["status"] != "ready":
        raise ProposalError(f"change {change_id} is {c['status']}; only texts waiting for approval can be approved")
    with ctx.db.connection() as conn:
        conn.execute("update changes set decided_by = %s, decided_at = now() where id = %s", (decided_by, change_id))
    if c["send_at"] and c["send_at"] > datetime.now(timezone.utc):
        with ctx.db.connection() as conn:
            conn.execute("update changes set status = 'scheduled' where id = %s and status = 'ready'", (change_id,))
        return {"id": change_id, "status": "scheduled", "send_at": c["send_at"].isoformat()}
    claimed = claim(ctx, change_id, "ready")
    if claimed is None:
        raise ProposalError(f"change {change_id} is already being sent")
    results = send(ctx, claimed)
    finish(ctx, change_id, results)
    return {"id": change_id, "status": "applied", "sent": sum(r["ok"] for r in results), "failed": sum(not r["ok"] for r in results)}


def send_due(ctx: ToolContext) -> int:
    """Send every scheduled batch whose time has come. Returns how many batches went out."""
    with ctx.db.connection() as conn:
        due = conn.execute("select id from changes where kind = 'guest_texts' and status = 'scheduled' and send_at <= now()").fetchall()
    sent = 0
    for row in due:
        claimed = claim(ctx, row["id"], "scheduled")
        if claimed is not None:
            finish(ctx, row["id"], send(ctx, claimed))
            sent += 1
    return sent


async def scheduler(get_ctx, every_s: int = 30) -> None:
    """Background loop in core: sends scheduled guest texts when due."""
    while True:
        try:
            n = await asyncio.to_thread(send_due, get_ctx())
            if n:
                log.info("sent %s scheduled guest-text batch(es)", n)
        except Exception:  # keep the loop alive; the error goes to the core log for Doss's health tool
            log.exception("scheduled guest texts failed")
        await asyncio.sleep(every_s)
