"""send_text: text the guest one of the hotel's templates (sms_templates.yaml). The model picks the template, never the wording."""

from hotelcore.sms import compose, send_and_record
from hotelcore.tools.context import ToolContext, ToolError


def send_text(ctx: ToolContext, template: str, to: str = "", booking_id: int | None = None) -> dict:
    number = (to or ctx.caller_phone).strip()
    if not number.startswith("+"):
        raise ToolError("I need the mobile number with the country code, for example +1 830 555 1234.")
    body = compose(ctx, template, booking_id, number)
    if not send_and_record(ctx, number, body, template):
        return {"sent": False, "message": "The text did not go through; a team member will send it."}
    return {"sent": True, "to": number, "template": template}
