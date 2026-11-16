"""check_availability: free rooms with total and nightly prices from Beds24 offers."""

from datetime import date

from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.rooms import property_info, room_types


def parse_stay(ctx: ToolContext, arrival: str, departure: str) -> tuple[date, date]:
    """Validate dates; errors are phrased for the guest."""
    try:
        start, end = date.fromisoformat(arrival), date.fromisoformat(departure)
    except ValueError:
        raise ToolError("I need the dates as year-month-day, for example 2026-11-20.")
    if end <= start:
        raise ToolError("Check-out must be after check-in.")
    if start < ctx.now().date():
        raise ToolError("That check-in date is in the past.")
    return start, end


def check_availability(ctx: ToolContext, arrival: str, departure: str, adults: int, children: int) -> dict:
    start, end = parse_stay(ctx, arrival, departure)
    nights = (end - start).days
    offers = ctx.pms.get_all(
        "/inventory/rooms/offers", propertyId=ctx.pms.property_id,
        arrival=arrival, departure=departure, numAdults=adults, numChildren=children,
    )
    rooms = room_types(ctx)
    available = []
    for room in offers:
        prices = [o["price"] for o in room.get("offers", []) if o.get("unitsAvailable", 0) > 0 and o.get("price")]
        info = rooms.get(room["roomId"])
        if not prices or info is None or (info["max_guests"] or 0) < adults + children:
            continue
        total = min(prices)
        available.append({"room_id": room["roomId"], "name": info["name"], "max_guests": info["max_guests"],
                          "beds": info["beds"], "total_price": total, "nightly_average": round(total / nights, 2)})
    available.sort(key=lambda r: r["total_price"])
    return {
        "arrival": arrival, "departure": departure, "nights": nights, "adults": adults, "children": children,
        "currency": property_info(ctx).get("currency", "USD"),
        "available": available,
        **({} if available else {"message": "No rooms are free for those dates and guests."}),
    }
