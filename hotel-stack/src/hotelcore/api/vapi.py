"""Vapi server messages: run tool calls, store end-of-call reports."""

import json

from hotelcore.tools import ToolContext, run_tool


def tool_context(base: ToolContext, call: dict) -> ToolContext:
    """Per-call context from the payload itself (no dependency on an earlier webhook)."""
    return ToolContext(
        hotel=base.hotel, pms=base.pms, data_dir=base.data_dir, channel="voice", sms=base.sms, slack=base.slack, db=base.db,
        caller_phone=(call.get("customer") or {}).get("number", ""), conversation_id=call.get("id", ""),
    )


def handle_tool_calls(message: dict, base: ToolContext) -> tuple[dict, list]:
    """Vapi contract: HTTP 200, one {toolCallId, result|error} per call, flat strings. Also returns a log to store later."""
    ctx = tool_context(base, message.get("call") or {})
    results, log = [], []
    for call in message.get("toolCallList", []):
        fn = call.get("function", {})
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            args = json.loads(args or "{}")
        out = run_tool(fn["name"], args, ctx)
        log.append((ctx.conversation_id, fn["name"], args, out))
        key = "result" if out["ok"] else "error"
        value = json.dumps(out["result"]) if out["ok"] else out["error"]
        results.append({"toolCallId": call["id"], key: value})
    return {"results": results}, log


def store_tool_log(log: list, ctx: ToolContext) -> None:
    from hotelcore.calls import save_tool_call
    with ctx.db.connection() as conn:
        for call_id, name, args, out in log:
            save_tool_call(conn, call_id, "voice", name, args, out)


def store_end_of_call(message: dict, ctx: ToolContext) -> None:
    """Save the report, then analyze it with Claude (summary, intent, outcome, sentiment)."""
    from hotelcore.calls import analyze_and_store, save_call
    with ctx.db.connection() as conn:
        call_id = save_call(conn, message)
        analyze_and_store(conn, call_id)
