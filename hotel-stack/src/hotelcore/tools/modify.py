"""modify_reservation: change dates or guests of a direct booking in the same room. Two phases:
confirm=false returns the new total without changing anything; confirm=true writes to Beds24.

Pricing: nights already booked keep the price the guest paid (prorated); only added nights are quoted
from Beds24 (quoting the whole range fails because the room is occupied by this very booking).
"""

from datetime import date, timedelta

from hotelcore.tools.availability import parse_stay
from hotelcore.tools.booking import quoted_total
from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.rooms import room_types

DIRECT_CHANNELS = {"", "direct", "none", None}
ACTIONS = {"checkAvailability": True, "notifyGuest": False, "notifyHost": True, "allowWebhooks": True}


def segments(nights: list[date]) -> list[tuple[date, date]]:
    """Group sorted nights into contiguous (arrival, departure) ranges."""
    ranges = []
    for night in nights:
        if ranges and ranges[-1][1] == night:
            ranges[-1] = (ranges[-1][0], night + timedelta(days=1))
        else:
            ranges.append((night, night + timedelta(days=1)))
    return ranges


def new_total(ctx: ToolContext, booking: dict, start: date, end: date, adults: int, children: int) -> float:
    old_start, old_end = date.fromisoformat(booking["arrival"]), date.fromisoformat(booking["departure"])
    old_nights = {old_start + timedelta(days=i) for i in range((old_end - old_start).days)}
    new_nights = [start + timedelta(days=i) for i in range((end - start).days)]
    per_night = (booking.get("price") or 0) / max(len(old_nights), 1)
    kept = sum(1 for n in new_nights if n in old_nights)
    added = [n for n in new_nights if n not in old_nights]
    extra = sum(quoted_total(ctx, booking["roomId"], a.isoformat(), d.isoformat(), adults, children) for a, d in segments(added))
    return round(per_night * kept + extra, 2)


def modify_reservation(
    ctx: ToolContext, booking_id: int, confirm: bool, arrival: str = "", departure: str = "",
    adults: int | None = None, children: int | None = None,
) -> dict:
    found = ctx.pms.get_all("/bookings", propertyId=ctx.pms.property_id, id=int(booking_id))
    if not found or found[0].get("status") == "cancelled":
        raise ToolError("I couldn't find an active reservation with that number.")
    booking = found[0]
    if booking.get("channel") not in DIRECT_CHANNELS:
        raise ToolError(f"This reservation was made through {booking['channel']}, so changes must be made there.")
    arrival, departure = arrival or booking["arrival"], departure or booking["departure"]
    adults = booking.get("numAdult", 1) if adults is None else adults
    children = booking.get("numChild", 0) if children is None else children
    start, end = parse_stay(ctx, arrival, departure)
    room = room_types(ctx).get(booking["roomId"], {})
    if (room.get("max_guests") or 0) < adults + children:
        raise ToolError(f"{room.get('name', 'That room')} sleeps at most {room.get('max_guests')} guests.")
    total = new_total(ctx, booking, start, end, adults, children)
    summary = {"booking_id": booking["id"], "room": room.get("name"), "arrival": arrival, "departure": departure,
               "adults": adults, "children": children, "new_total": total, "old_total": booking.get("price")}
    if not confirm:
        return {**summary, "changed": False, "message": "Read the new total to the guest and ask them to confirm."}
    ctx.pms.post("/bookings", [{"id": booking["id"], "arrival": arrival, "departure": departure,
                                "numAdult": adults, "numChild": children, "price": total, "actions": ACTIONS}])
    return {**summary, "changed": True}
