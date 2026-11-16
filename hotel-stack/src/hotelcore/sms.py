"""Hotel-written SMS templates (hotels/<id>/sms_templates.yaml): fill, send via Twilio, record in text_messages."""

import yaml
from psycopg.types.json import Jsonb

from hotelcore.notify import SendError
from hotelcore.payments import booking, deposit_for, link_for_booking
from hotelcore.render import render
from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.rooms import room_types


def load_templates(ctx: ToolContext) -> dict[str, dict]:
    return yaml.safe_load((ctx.hotel.root / "sms_templates.yaml").read_text())


def guests_phrase(adults: int, children: int) -> str:
    parts = [f"{adults} adult{'s' if adults != 1 else ''}"]
    if children:
        parts.append(f"{children} child{'ren' if children != 1 else ''}")
    return ", ".join(parts)


def money(n) -> str:
    return f"{float(n):,.2f}".removesuffix(".00")


def booking_values(ctx: ToolContext, booking_id: int, phone: str, with_link: bool) -> dict:
    """Everything a booking template needs, from Beds24 and the payments table (never from the model).
    A payment link is created only when the template shows one."""
    b = booking(ctx, booking_id)
    values = {
        "booking_id": b["id"], "room": room_types(ctx).get(b.get("roomId"), {}).get("name", "your cabin"),
        "arrival": b.get("arrival"), "departure": b.get("departure"),
        "guests": guests_phrase(b.get("numAdult", 1), b.get("numChild", 0)),
        "total": money(b.get("price") or 0), "deposit": money(deposit_for(ctx, b.get("price") or 0)), "pay_link": "",
    }
    if with_link:
        link = link_for_booking(ctx, booking_id, phone)
        values.update(deposit=money(link["amount"]), pay_link=link["url"])
    return values


def compose(ctx: ToolContext, name: str, booking_id: int | None = None, phone: str = "", **extra) -> str:
    """Render a template: {{facts.x}} from facts.yaml, then {booking values}, with `extra` overriding them."""
    template = load_templates(ctx).get(name)
    if template is None:
        raise ToolError(f"There is no text called {name}.")
    text = " ".join(render(template["text"], ctx.hotel.facts).split())
    if template.get("needs_booking"):
        if not booking_id:
            raise ToolError("I need the booking number to send that text.")
        values = booking_values(ctx, int(booking_id), phone, with_link="{pay_link}" in text)
        text = text.format(**{**values, **extra})
    return text


def deliver(ctx: ToolContext, phone: str, body: str, source: str) -> dict:
    """Send one SMS and store it in the guest's thread. {ok, sid} or {ok: False, error} (e.g. opted out, bad number)."""
    if ctx.sms is None:
        return {"ok": False, "error": "texting is not configured"}
    try:
        sid = ctx.sms.send(phone, body)
    except SendError as e:
        return {"ok": False, "error": str(e)}
    if ctx.db is not None:
        with ctx.db.connection() as conn:
            conn.execute("insert into text_messages (guest_phone, direction, body, twilio_sid, tools) values (%s, 'out', %s, %s, %s)",
                         (phone, body, sid, Jsonb([{"name": source, "ok": True}])))
    return {"ok": True, "sid": sid}


def send_and_record(ctx: ToolContext, phone: str, body: str, template: str) -> bool:
    """Send one SMS; store it as an outbound message of the guest's thread. False if texting is off or failed."""
    return deliver(ctx, phone, body, f"send_text:{template}")["ok"]
