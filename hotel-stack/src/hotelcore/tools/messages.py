"""take_message: save a callback request for the team (Postgres team_messages; JSON lines when no database)."""

import json

from hotelcore.tools.context import ToolContext, ToolError


def take_message(ctx: ToolContext, guest_name: str, phone: str, reason: str) -> dict:
    if not reason.strip():
        raise ToolError("What should I tell the team?")
    record = {
        "at": ctx.now().isoformat(timespec="seconds"),
        "channel": ctx.channel,
        "conversation_id": ctx.conversation_id,
        "caller_phone": ctx.caller_phone,
        "guest_name": guest_name.strip(),
        "callback_phone": phone.strip() or ctx.caller_phone,
        "reason": reason.strip(),
    }
    if ctx.db is not None:
        from hotelcore.calls import save_message
        with ctx.db.connection() as conn:
            save_message(conn, record)
    else:
        ctx.data_dir.mkdir(parents=True, exist_ok=True)
        with (ctx.data_dir / "messages.jsonl").open("a") as f:
            f.write(json.dumps(record) + "\n")
    return {"saved": True, "message": "Message saved. The team will call back."}
