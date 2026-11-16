"""Read-only Beds24 tools. Annotated readOnlyHint=True so Hermes runs them without approval."""

from beds24_mcp.app import ALL_STATUSES, READ_ONLY, bookings, client, hotel, mcp


@mcp.tool(annotations=READ_ONLY)
def get_hotel() -> dict:
    """Hotel settings and room types (ids, names, quantities, capacity)."""
    return hotel()


@mcp.tool(annotations=READ_ONLY)
def find_reservations(query: str) -> list[dict]:
    """Find reservations in any status (cancelled included).
    A numeric query is a Beds24 booking id; anything else searches guest name, email and phone."""
    if query.strip().isdigit():
        return bookings(id=int(query), status=ALL_STATUSES)
    return bookings(searchString=query, status=ALL_STATUSES)


@mcp.tool(annotations=READ_ONLY)
def list_reservations(arrival_from: str, arrival_to: str, status: str | None = None) -> list[dict]:
    """Reservations arriving between two dates (YYYY-MM-DD, inclusive).
    Beds24 omits cancelled bookings unless status is given: confirmed, new, request, cancelled, black, inquiry."""
    return bookings(arrivalFrom=arrival_from, arrivalTo=arrival_to, status=status)


@mcp.tool(annotations=READ_ONLY)
def get_arrivals(date: str) -> list[dict]:
    """Reservations arriving on a date (YYYY-MM-DD)."""
    return bookings(arrival=date)


@mcp.tool(annotations=READ_ONLY)
def get_departures(date: str) -> list[dict]:
    """Reservations departing on a date (YYYY-MM-DD)."""
    return bookings(departure=date)


@mcp.tool(annotations=READ_ONLY)
def get_availability(start_date: str, end_date: str) -> list[dict]:
    """Per-room availability by day between two dates (YYYY-MM-DD). Past dates may be omitted by Beds24."""
    return client().get_all(
        "/inventory/rooms/availability", propertyId=client().property_id, startDate=start_date, endDate=end_date
    )


@mcp.tool(annotations=READ_ONLY)
def quote_stay(arrival: str, departure: str, adults: int, children: int = 0) -> list[dict]:
    """Bookable offers for a stay. Each offer's price is the TOTAL for the whole stay, not per night.
    Use this for quotes, not calendar prices."""
    return client().get_all(
        "/inventory/rooms/offers", propertyId=client().property_id,
        arrival=arrival, departure=departure, numAdults=adults, numChildren=children,
    )
