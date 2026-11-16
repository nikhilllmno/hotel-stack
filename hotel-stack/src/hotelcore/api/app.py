"""FastAPI app: health check, Vapi webhook, Twilio SMS webhook, demo /pay page, dashboard API.

Run: uv run uvicorn hotelcore.api.app:app --port 8000
"""

import hmac
import logging
import os
from collections import deque
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from hotelcore.api.apps_api import public as public_pages, router as apps_router
from hotelcore.api.changes_api import router as changes_router
from hotelcore.api.dashboard import router as dashboard_router
from hotelcore.api.pay import router as pay_router
from hotelcore.api.reports_api import router as reports_router
from hotelcore.api.twilio_sms import router as sms_router
from hotelcore.api.vapi import handle_tool_calls, store_end_of_call, store_tool_log
from hotelcore import guest_texts
from hotelcore.config import load_hotel
from hotelcore.db import make_pool
from hotelcore.notify import SlackAlerts, TwilioSms
from hotelcore.pms.beds24 import Beds24Client
from hotelcore.tools import ToolContext
from hotelcore.tools.rooms import property_info

REPO = Path(__file__).resolve().parents[3]
LOG_FILE = REPO / "data" / "logs" / "core.log"
STARTED_AT = datetime.now(timezone.utc)
log = logging.getLogger("hotelcore")


def log_to_file() -> None:
    """Warnings and errors (ours and uvicorn's) also go to data/logs/core.log, which Doss reads via /api/health."""
    root = logging.getLogger()
    if any(isinstance(h, RotatingFileHandler) and h.baseFilename == str(LOG_FILE) for h in root.handlers):
        return
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=2)
    handler.setLevel(logging.WARNING)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    for name in ("", "uvicorn.error"):
        logging.getLogger(name).addHandler(handler)


def recent_log_lines(n: int = 30) -> list[str]:
    if not LOG_FILE.exists():
        return []
    with LOG_FILE.open() as f:
        return [line.rstrip() for line in deque(f, maxlen=n)]


def build_context() -> ToolContext:
    load_dotenv(REPO / ".env")
    hotel = load_hotel(REPO / "hotels" / os.environ.get("HOTEL_ID", "contigo-ranch"))
    slack = SlackAlerts.from_env(default_channel=hotel.facts.get("alerts", {}).get("slack_owner_user_id", ""))
    return ToolContext(hotel=hotel, pms=Beds24Client.from_env(), data_dir=REPO / "data", sms=TwilioSms.from_env(),
                       slack=slack, db=make_pool())


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_to_file()
    app.state.ctx = build_context()
    app.state.secret = os.environ["VAPI_SERVER_SECRET"]
    await run_in_threadpool(property_info, app.state.ctx)  # warm token + room cache before the first call
    sender = asyncio.create_task(guest_texts.scheduler(lambda: app.state.ctx))  # scheduled guest texts
    yield
    sender.cancel()


app = FastAPI(title="hotel core", lifespan=lifespan)
app.include_router(dashboard_router)
app.include_router(changes_router)
app.include_router(reports_router)
app.include_router(apps_router)
app.include_router(public_pages)
app.include_router(sms_router)
app.include_router(pay_router)


@app.get("/health")
def health():
    return {"ok": True, "hotel": app.state.ctx.hotel.hotel_id}


@app.post("/vapi/webhook")
async def vapi_webhook(request: Request, background: BackgroundTasks, x_vapi_secret: str = Header(default="")):
    if not hmac.compare_digest(x_vapi_secret, app.state.secret):
        raise HTTPException(status_code=401, detail="bad secret")
    message = (await request.json()).get("message", {})
    kind = message.get("type")
    if kind == "tool-calls":
        response, log = await run_in_threadpool(handle_tool_calls, message, app.state.ctx)
        background.add_task(store_tool_log, log, app.state.ctx)  # after the response: no added latency
        return response
    if kind == "end-of-call-report":
        background.add_task(store_end_of_call, message, app.state.ctx)
    return {}
