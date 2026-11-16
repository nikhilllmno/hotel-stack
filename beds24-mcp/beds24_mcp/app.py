"""Shared MCP server instance, Beds24 client and booking helpers."""

from pathlib import Path

from dotenv import load_dotenv
from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from beds24_mcp.client import Beds24Client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

mcp = MCPServer("beds24")

READ_ONLY = ToolAnnotations(readOnlyHint=True)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True)

ALL_STATUSES = ["confirmed", "new", "request", "cancelled", "black", "inquiry"]
BOOKING_FIELDS = (
    "id", "reference", "status", "channel", "roomId", "roomName", "unitId", "arrival", "departure",
    "numAdult", "numChild", "firstName", "lastName", "email", "phone", "mobile",
    "price", "deposit", "arrivalTime", "comments", "notes", "bookingTime",
)

_client: Beds24Client | None = None
_room_names: dict[int, str] | None = None


def client() -> Beds24Client:
    """Create the Beds24 client on first use so the server starts without network calls."""
    global _client
    if _client is None:
        _client = Beds24Client.from_env()
    return _client


def hotel() -> dict:
    rows = client().get_all("/properties", id=client().property_id, includeAllRooms=True)
    return rows[0] if rows else {}


def room_names() -> dict[int, str]:
    """Room id -> name, fetched once per server process."""
    global _room_names
    if _room_names is None:
        _room_names = {r["id"]: r["name"] for r in hotel().get("roomTypes", [])}
    return _room_names


def compact(booking: dict) -> dict:
    """Keep the booking fields an owner needs, add the room name, drop empty values."""
    booking = {**booking, "roomName": room_names().get(booking.get("roomId"))}
    return {k: booking[k] for k in BOOKING_FIELDS if booking.get(k) not in (None, "", [])}


def bookings(**params) -> list[dict]:
    return [compact(b) for b in client().get_all("/bookings", propertyId=client().property_id, **params)]
