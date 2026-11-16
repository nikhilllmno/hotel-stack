"""Beds24 write tools. No readOnlyHint, so Hermes asks the owner before every call
(the server is configured `trust: untrusted`)."""

from beds24_mcp.app import DESTRUCTIVE, WRITE, client, mcp

# Keep channels in sync and stay silent towards guests unless the owner asks otherwise.
ACTIONS = {"notifyGuest": False, "notifyHost": False, "allowWebhooks": True}


@mcp.tool(annotations=WRITE)
def create_reservation(
    room_id: int, arrival: str, departure: str, adults: int, children: int,
    first_name: str, last_name: str, price: float,
    phone: str | None = None, email: str | None = None, notes: str | None = None,
) -> list[dict]:
    """Create a confirmed reservation. Get `price` (total for the stay) from quote_stay first.
    Beds24 checks availability and rejects the booking if the room is not free."""
    item = {
        "roomId": room_id, "status": "confirmed", "arrival": arrival, "departure": departure,
        "numAdult": adults, "numChild": children, "firstName": first_name, "lastName": last_name,
        "price": price, "phone": phone, "email": email, "notes": notes,
        "actions": {**ACTIONS, "checkAvailability": True, "assignBooking": True},
    }
    return client().post("/bookings", [{k: v for k, v in item.items() if v is not None}])


@mcp.tool(annotations=WRITE)
def modify_reservation(
    booking_id: int, arrival: str | None = None, departure: str | None = None, room_id: int | None = None,
    adults: int | None = None, children: int | None = None, price: float | None = None, notes: str | None = None,
) -> list[dict]:
    """Change an existing reservation. Only the fields you pass are changed.
    When dates, room or guests change, quote_stay first and pass the new total `price`."""
    changes = {
        "arrival": arrival, "departure": departure, "roomId": room_id,
        "numAdult": adults, "numChild": children, "price": price, "notes": notes,
    }
    item = {"id": booking_id, **{k: v for k, v in changes.items() if v is not None}, "actions": ACTIONS}
    return client().post("/bookings", [item])


@mcp.tool(annotations=DESTRUCTIVE)
def cancel_reservation(booking_id: int) -> list[dict]:
    """Cancel a reservation. The booking record is kept with status cancelled."""
    return client().post("/bookings", [{"id": booking_id, "status": "cancelled", "actions": ACTIONS}])


@mcp.tool(annotations=WRITE)
def set_daily_price(room_id: int, from_date: str, to_date: str, price: float | None) -> list[dict]:
    """Override the nightly price for a room on each date from from_date to to_date (YYYY-MM-DD, inclusive).
    price=None removes the override so the room's normal price applies again."""
    return client().post(
        "/inventory/rooms/calendar",
        [{"roomId": room_id, "calendar": [{"from": from_date, "to": to_date, "price1": price}]}],
    )


@mcp.tool(annotations=WRITE)
def set_min_stay(room_id: int, from_date: str, to_date: str, nights: int) -> list[dict]:
    """Set the minimum stay (nights, at least 1) for a room on each date in the range.
    To remove a restriction set nights=1 (Beds24 ignores null here)."""
    return client().post(
        "/inventory/rooms/calendar",
        [{"roomId": room_id, "calendar": [{"from": from_date, "to": to_date, "minStay": max(1, nights)}]}],
    )
