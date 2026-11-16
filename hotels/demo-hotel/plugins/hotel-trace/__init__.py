"""Tag LLM requests so OpenRouter Broadcast groups traces by hotel, agent and session.

Adds OpenRouter's `user` and `trace` body fields via an `llm_request` middleware.
The hotel id is the HERMES_HOME folder name (one home per hotel).
"""

from hermes_constants import get_hermes_home

AGENT_NAME = "owner-copilot"
ENVIRONMENT = "dev"


def register(ctx):
    ctx.register_middleware("llm_request", tag_request)


def tag_request(request, session_id=None, model=None, **kwargs):
    """Merge `user` and `trace` into extra_body, keeping fields other plugins set."""
    hotel_id = get_hermes_home().name
    extra_body = dict(request.get("extra_body") or {})
    extra_body.setdefault("user", hotel_id)
    extra_body["trace"] = {
        **(extra_body.get("trace") or {}),
        "trace_id": session_id or "no-session",
        "trace_name": AGENT_NAME,
        "generation_name": model or "llm",
        "hotel_id": hotel_id,
        "agent": AGENT_NAME,
        "environment": ENVIRONMENT,
    }
    return {"request": {**request, "extra_body": extra_body}, "source": "hotel-trace", "reason": "trace tags"}
