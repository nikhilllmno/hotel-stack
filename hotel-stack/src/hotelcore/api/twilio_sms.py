"""Twilio inbound SMS webhook. Verifies X-Twilio-Signature, answers at once, replies from the background."""

import base64
import hashlib
import hmac
import os

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from hotelcore.text_agent import reply_to

router = APIRouter()
EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


def twilio_signature(auth_token: str, url: str, params: dict[str, str]) -> str:
    """Twilio's scheme: HMAC-SHA1 over the full URL + every POST param (sorted by name) as name+value, base64."""
    payload = url + "".join(k + params[k] for k in sorted(params))
    return base64.b64encode(hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()).decode()


@router.post("/twilio/sms")
async def inbound_sms(request: Request, background: BackgroundTasks):
    params = {k: str(v) for k, v in (await request.form()).items()}
    url = os.environ["PUBLIC_BASE_URL"].rstrip("/") + "/twilio/sms"
    expected = twilio_signature(os.environ["TWILIO_AUTH_TOKEN"], url, params)
    if not hmac.compare_digest(expected, request.headers.get("x-twilio-signature", "")):
        raise HTTPException(status_code=403, detail="bad twilio signature")
    if params.get("Body", "").strip():
        background.add_task(reply_to, request.app.state.ctx, params["From"], params["Body"].strip(), params["MessageSid"])
    return Response(content=EMPTY_TWIML, media_type="text/xml")
