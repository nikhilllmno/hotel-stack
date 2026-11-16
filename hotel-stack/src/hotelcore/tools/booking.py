"""create_reservation: a Beds24 booking with status 'request'; staff confirm it and take payment.

The price is re-quoted here from Beds24, never taken from the model.
"""

from hotelcore.tools.availability import parse_stay
from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.rooms import room_types

ACTIONS = {"checkAvailability": True, "assignBooking": True, "notifyGuest": False, "notifyHost": True, "allowWebhooks": True}


def quoted_total(ctx: ToolContext, room_id: int, arrival: str, departure: str, adults: int, children: int) -> float:
    offers = ctx.pms.get_all(
        "/inventory/rooms/offers", propertyId=ctx.pms.property_id, roomId=room_id,
        arrival=arrival, departure=departure, numAdults=adults, numChildren=children,
    )
    prices = [o["price"] for r in offers if r.get("roomId") == room_id
              for o in r.get("offers", []) if o.get("unitsAvailable", 0) > 0 and o.get("price")]
    if not prices:
        raise ToolError("That room is no longer free for those dates. Let me check what else is available.")
    return min(prices)


def create_reservation(
    ctx: ToolContext, room_id: int, arrival: str, departure: str, adults: int, children: int,
    first_name: str, last_name: str, phone: str = "", email: str = "", notes: str = "", pets: int = 0,
) -> dict:
    parse_stay(ctx, arrival, departure)
    room = room_types(ctx).get(room_id)
    if room is None:
        raise ToolError("I don't recognise that room. Let me check availability again.")
    if (room["max_guests"] or 0) < adults + children:
        raise ToolError(f"{room['name']} sleeps at most {room['max_guests']} guests.")
    total = quoted_total(ctx, room_id, arrival, departure, adults, children)
    item = {
        "roomId": room_id, "status": "request", "arrival": arrival, "departure": departure,
        "numAdult": adults, "numChild": children, "firstName": first_name.strip(), "lastName": last_name.strip(),
        "phone": phone.strip() or ctx.caller_phone, "email": email.strip(), "price": total,
        "notes": f"Booked by AI {ctx.channel} agent (caller {ctx.caller_phone or 'unknown'}). Dogs: {pets}. {notes}".strip(),
        "actions": ACTIONS,
    }
    result = ctx.pms.post("/bookings", [{k: v for k, v in item.items() if v not in ("", None)}])
    return {
        "booking_id": result[0]["new"]["id"],
        "status": "request",
        "room": room["name"], "arrival": arrival, "departure": departure, "total_price": total,
        "message": "Booking requested. The team will confirm it and arrange payment.",
    }
