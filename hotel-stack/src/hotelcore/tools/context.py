"""What every tool receives, and the error type whose message is safe to say to a guest."""

from dataclasses import dataclass
from typing import Any
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from hotelcore.config import HotelConfig
from hotelcore.notify import SlackAlerts, TwilioSms
from hotelcore.pms.beds24 import Beds24Client


class ToolError(Exception):
    """A failure the agent can read out as is ("Check-out must be after check-in")."""


@dataclass
class ToolContext:
    hotel: HotelConfig
    pms: Beds24Client
    data_dir: Path
    channel: str = "voice"
    caller_phone: str = ""
    conversation_id: str = ""
    sms: TwilioSms | None = None
    slack: SlackAlerts | None = None
    db: Any = None  # psycopg ConnectionPool; None in tests and evals

    def now(self) -> datetime:
        """Current time in the hotel's time zone."""
        return datetime.now(ZoneInfo(self.hotel.facts["property"]["time_zone"]))
