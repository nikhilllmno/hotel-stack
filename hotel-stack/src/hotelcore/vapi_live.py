"""Talk into a live Vapi call (live call control: the call's monitor.controlUrl)."""

import logging
import os

import httpx

log = logging.getLogger(__name__)


def tell_live_call(call_id: str, note: str) -> bool:
    """Add a system note to the call and let Danny respond now. False if the call has ended or Vapi refused.
    Never raises: the payment it reports has already succeeded."""
    try:
        return _tell(call_id, note)
    except httpx.HTTPError as e:
        log.error("live call %s not told: %s", call_id, e)
        return False


def _tell(call_id: str, note: str) -> bool:
    with httpx.Client(base_url="https://api.vapi.ai", timeout=10,
                      headers={"Authorization": f"Bearer {os.environ['VAPI_API_KEY']}"}) as vapi:
        call = vapi.get(f"/call/{call_id}").raise_for_status().json()
    control = (call.get("monitor") or {}).get("controlUrl")
    if call.get("status") != "in-progress" or not control:
        return False
    httpx.post(control, timeout=10, json={"type": "add-message", "triggerResponseEnabled": True,
                                          "message": {"role": "system", "content": note}}).raise_for_status()
    log.info("told live call %s: %s", call_id, note)
    return True
