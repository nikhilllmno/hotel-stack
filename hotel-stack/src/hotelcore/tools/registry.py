"""Tool registry: tools.yaml (what the model sees) joined with Python functions (what runs)."""

import logging
import time
from dataclasses import dataclass
from typing import Callable

import yaml

from hotelcore.config import HotelConfig
from hotelcore.pms.beds24 import Beds24Error
from hotelcore.tools.alerts import alert_upset_guest
from hotelcore.tools.availability import check_availability
from hotelcore.tools.booking import create_reservation
from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.knowledge import search_knowledge_base
from hotelcore.tools.messages import take_message
from hotelcore.tools.modify import modify_reservation
from hotelcore.tools.reservations import find_reservation
from hotelcore.tools.rooms import get_rooms_info
from hotelcore.tools.send_text import send_text

log = logging.getLogger(__name__)

IMPLEMENTATIONS: dict[str, Callable] = {
    "get_rooms_info": get_rooms_info,
    "check_availability": check_availability,
    "create_reservation": create_reservation,
    "find_reservation": find_reservation,
    "search_knowledge_base": search_knowledge_base,
    "take_message": take_message,
    "modify_reservation": modify_reservation,
    "send_text": send_text,
    "alert_upset_guest": alert_upset_guest,
}
PMS_DOWN = "I can't reach our reservation system right now. I can take a message and the team will call you back."


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict
    channels: tuple[str, ...]
    filler: str


def load_specs(hotel: HotelConfig) -> dict[str, ToolSpec]:
    """Read tools.yaml and fail fast if a tool has no implementation or vice versa."""
    raw = yaml.safe_load((hotel.root / "tools.yaml").read_text())
    if "send_text" in raw:
        add_template_choices(hotel, raw["send_text"])
    if set(raw) != set(IMPLEMENTATIONS):
        raise ValueError(f"tools.yaml and IMPLEMENTATIONS differ: {sorted(set(raw) ^ set(IMPLEMENTATIONS))}")
    return {
        name: ToolSpec(name, " ".join(t["description"].split()), t["parameters"], tuple(t["channels"]), t.get("filler", ""))
        for name, t in raw.items()
    }


def add_template_choices(hotel: HotelConfig, spec: dict) -> None:
    """send_text's template list comes from sms_templates.yaml, so a new template is a one-file change."""
    templates = yaml.safe_load((hotel.root / "sms_templates.yaml").read_text())
    offered = {name: t for name, t in templates.items() if not t.get("internal")}
    prop = spec["parameters"]["properties"]["template"]
    prop["enum"] = list(offered)
    prop["description"] = "Which pre-written text to send: " + "; ".join(
        f"{name} = {' '.join(t['description'].split())}" + (" (needs booking_id)" if t.get("needs_booking") else "")
        for name, t in offered.items())


def specs_for(specs: dict[str, ToolSpec], channel: str) -> list[ToolSpec]:
    return [s for s in specs.values() if channel in s.channels]


def run_tool(name: str, args: dict, ctx: ToolContext) -> dict:
    """Run one tool. Always returns {"ok", "result"|"error", "ms"}; errors are sentences the agent can say."""
    started = time.perf_counter()
    try:
        result = {"ok": True, "result": IMPLEMENTATIONS[name](ctx, **args)}
    except ToolError as e:
        result = {"ok": False, "error": str(e)}
    except Beds24Error as e:
        log.error("tool %s: %s", name, e)
        result = {"ok": False, "error": PMS_DOWN}
    except TypeError as e:  # wrong or missing arguments from the model
        result = {"ok": False, "error": f"Bad arguments for {name}: {e}"}
    return {**result, "ms": round((time.perf_counter() - started) * 1000)}
