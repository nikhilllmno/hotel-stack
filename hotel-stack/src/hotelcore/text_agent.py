"""SMS agent: one inbound text -> Claude with the text prompt and text-channel tools -> reply sent via Twilio.

The guest's phone number links everything: earlier texts and their latest call summary are given as context.
"""

from psycopg.types.json import Jsonb

import anthropic

from hotelcore.claude_agent import anthropic_tools, run_turn, text_of
from hotelcore.prompts import build_text_prompt
from hotelcore.tools import ToolContext

HISTORY = 20
FALLBACK = "Sorry, I couldn't process that just now. The front desk team will get back to you shortly."


def guest_context(conn, phone: str) -> tuple[list[dict], str]:
    """Earlier texts as alternating user/assistant turns, and a note about their latest call."""
    rows = conn.execute("select direction, body from text_messages where guest_phone = %s order by created_at desc limit %s",
                        (phone, HISTORY)).fetchall()[::-1]
    turns: list[dict] = []
    for r in rows:
        role = "user" if r["direction"] == "in" else "assistant"
        if turns and turns[-1]["role"] == role:
            turns[-1]["content"] += "\n" + r["body"]
        else:
            turns.append({"role": role, "content": r["body"]})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    call = conn.execute("select started_at, summary from calls where caller_phone = %s and summary is not null "
                        "order by started_at desc limit 1", (phone,)).fetchone()
    note = f"\n\n# This guest's latest phone call ({call['started_at']:%b %d})\n{call['summary']}" if call else ""
    return turns, note


def reply_to(base: ToolContext, phone: str, body: str, sid: str) -> str | None:
    """Store the inbound text, produce and send Danny's reply, store it. Returns the reply (None for a retry)."""
    ctx = ToolContext(hotel=base.hotel, pms=base.pms, data_dir=base.data_dir, channel="text", caller_phone=phone,
                      conversation_id=f"sms:{phone}", sms=base.sms, slack=base.slack, db=base.db)
    with base.db.connection() as conn:
        inserted = conn.execute("insert into text_messages (guest_phone, direction, body, twilio_sid) values (%s, 'in', %s, %s) "
                                "on conflict (twilio_sid) do nothing returning id", (phone, body, sid)).fetchone()
        if inserted is None:
            return None  # Twilio retry of a message we already handled
        history, call_note = guest_context(conn, phone)
    system = build_text_prompt(ctx.hotel, ctx.now().strftime("%A, %B %d, %Y"), phone) + call_note
    used = run_turn(anthropic.Anthropic(), system, anthropic_tools(ctx, "text"), history, ctx)
    reply = text_of(history[-1]["content"]) or FALLBACK
    sent_sid = ctx.sms.send(phone, reply) if ctx.sms else None
    with base.db.connection() as conn:
        conn.execute("insert into text_messages (guest_phone, direction, body, twilio_sid, tools) values (%s, 'out', %s, %s, %s)",
                     (phone, reply, sent_sid, Jsonb([{"name": n, "arguments": a, "ok": o["ok"]} for n, a, o in used])))
    return reply
