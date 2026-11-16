"""alert_upset_guest: quietly tell the owner on Slack. Returns alerted=false when Slack is not set up, so the agent takes a message instead."""

from hotelcore.notify import SendError
from hotelcore.tools.context import ToolContext


def alert_upset_guest(ctx: ToolContext, guest_name: str, phone: str, issue: str) -> dict:
    if ctx.slack is None:
        return {"alerted": False}
    text = f":rotating_light: Upset caller: *{guest_name}* ({phone or ctx.caller_phone}): {issue}"
    try:
        ctx.slack.post(text)
    except SendError:
        return {"alerted": False}
    return {"alerted": True}
