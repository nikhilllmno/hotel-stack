"""Deposit payment links. Provider today: 'demo' (our own /pay page, no real charge). Later: Stripe Checkout.

Flow: link_for_booking() -> guest opens /pay/<token> -> mark_paid() -> Beds24 booking confirmed + deposit recorded
-> receipt text. The deposit is facts.payment.deposit_percent of the Beds24 booking total (never from the model).
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

from hotelcore.tools.context import ToolContext, ToolError

LINK_HOURS = 24


def public_url(token: str) -> str:
    return f"{os.environ['PUBLIC_BASE_URL'].rstrip('/')}/pay/{token}"


def booking(ctx: ToolContext, booking_id: int) -> dict:
    found = ctx.pms.get_all("/bookings", propertyId=ctx.pms.property_id, id=int(booking_id),
                            status=["confirmed", "new", "request", "cancelled", "black", "inquiry"])
    if not found:
        raise ToolError("I couldn't find that booking.")
    return found[0]


def deposit_for(ctx: ToolContext, total: float) -> float:
    return round(total * ctx.hotel.facts["payment"]["deposit_percent"] / 100, 2)


def link_for_booking(ctx: ToolContext, booking_id: int, guest_phone: str) -> dict:
    """Reuse the open, unexpired link for this booking, or create one. Returns {url, amount, token}.
    On a voice call the link remembers the call id, so paying during the call is announced live.
    Without a database (evals) a placeholder link is returned and nothing is stored."""
    if ctx.db is None:
        amount = deposit_for(ctx, booking(ctx, booking_id).get("price") or 0)
        return {"url": f"https://example.test/pay/demo-{booking_id}", "amount": amount, "token": f"demo-{booking_id}"}
    call_id = ctx.conversation_id if ctx.channel == "voice" else None
    with ctx.db.connection() as conn:
        row = conn.execute("select token, amount from payments where booking_id = %s and status = 'open' and expires_at > now() "
                           "order by id desc limit 1", (booking_id,)).fetchone()
        if row is None:
            b = booking(ctx, booking_id)
            if b.get("status") == "cancelled":
                raise ToolError("That booking is cancelled, so there's nothing to pay.")
            amount = deposit_for(ctx, b.get("price") or 0)
            row = {"token": secrets.token_urlsafe(16), "amount": amount}
            conn.execute("insert into payments (token, booking_id, guest_phone, amount, expires_at, call_id) "
                         "values (%s, %s, %s, %s, %s, %s)",
                         (row["token"], booking_id, guest_phone, amount, datetime.now(timezone.utc) + timedelta(hours=LINK_HOURS), call_id))
        elif call_id:
            conn.execute("update payments set call_id = %s where token = %s", (call_id, row["token"]))
    return {"url": public_url(row["token"]), "amount": float(row["amount"]), "token": row["token"]}


def payment(ctx: ToolContext, token: str) -> dict | None:
    with ctx.db.connection() as conn:
        return conn.execute("select * from payments where token = %s", (token,)).fetchone()


def mark_paid(ctx: ToolContext, token: str) -> dict:
    """Confirm the Beds24 booking and record the deposit. Idempotent: paying twice changes nothing."""
    p = payment(ctx, token)
    if p is None or p["status"] == "paid":
        return p
    if p["expires_at"] < datetime.now(timezone.utc):
        raise ToolError("This payment link has expired. Please contact the ranch for a new one.")
    b = booking(ctx, p["booking_id"])
    ctx.pms.post("/bookings", [{
        "id": p["booking_id"], "status": "confirmed", "deposit": float(p["amount"]),
        "notes": f"{b.get('notes', '')}\nDeposit ${float(p['amount']):.2f} paid via {p['provider']} link {datetime.now():%Y-%m-%d %H:%M}.".strip(),
        "actions": {"notifyGuest": False, "notifyHost": True, "allowWebhooks": True},
    }])
    with ctx.db.connection() as conn:
        conn.execute("update payments set status = 'paid', paid_at = now() where token = %s", (token,))
    return {**p, "status": "paid"}
