"""get_rooms_info: Beds24 room types joined with the hotel's own bed descriptions."""

import time

from hotelcore.tools.context import ToolContext

CACHE_SECONDS = 600
_cache: dict = {}


def property_info(ctx: ToolContext) -> dict:
    """The Beds24 property with room types, cached for 10 minutes (room setup rarely changes)."""
    hit = _cache.get(ctx.pms.property_id)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    rows = ctx.pms.get_all("/properties", id=ctx.pms.property_id, includeAllRooms=True)
    _cache[ctx.pms.property_id] = (time.time(), rows[0])
    return rows[0]


def room_types(ctx: ToolContext) -> dict[int, dict]:
    """Room id -> {name, max_guests, beds}."""
    facts_rooms = ctx.hotel.facts.get("rooms", {})
    return {
        r["id"]: {
            "name": r["name"],
            "max_guests": r.get("maxPeople"),
            "beds": facts_rooms.get(r["name"].lower().replace(" ", "_"), {}).get("beds"),
        }
        for r in property_info(ctx).get("roomTypes", [])
    }


def get_rooms_info(ctx: ToolContext) -> dict:
    checkin = ctx.hotel.facts["checkin"]
    return {
        "today": ctx.now().date().isoformat(),
        "check_in_time": checkin["time"],
        "check_out_time": checkin["checkout_time"],
        "rooms": [{"room_id": rid, **room} for rid, room in room_types(ctx).items()],
    }
