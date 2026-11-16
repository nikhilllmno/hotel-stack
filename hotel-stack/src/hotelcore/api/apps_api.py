"""Mini apps API: the owner's app list and live data for owner apps (dashboard key or Doss's key), plus the public
pages router (/p/<slug>, no key) whose data is limited to availability and hotel info."""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from hotelcore.api.dashboard import caller, ctx
from hotelcore.mini_apps import PUBLIC_BRIDGE, public_info, with_bridge
from hotelcore.tools.availability import check_availability
from hotelcore.tools.context import ToolError
from hotelcore.tools.reservations import ALL_STATUSES
from hotelcore.tools.rooms import room_types

router = APIRouter(prefix="/api", dependencies=[Depends(caller)])
public = APIRouter(prefix="/p")

# A public page may load inline scripts/styles, images and Google Fonts, and talk only to its own /p/api.
PUBLIC_CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
              "font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; "
              "form-action 'none'; frame-ancestors 'none'")


def public_url(slug: str) -> str:
    return f"{os.environ.get('PUBLIC_BASE_URL', '').rstrip('/')}/p/{slug}"


@router.get("/apps")
def list_apps(request: Request):
    with ctx(request).db.connection() as conn:
        rows = conn.execute("select slug, title, description, public, version, change_id, updated_at from mini_apps "
                            "order by updated_at desc").fetchall()
    return [{**r, "public_url": public_url(r["slug"]) if r["public"] else None} for r in rows]


@router.get("/apps/{slug}")
def get_app(request: Request, slug: str):
    with ctx(request).db.connection() as conn:
        row = conn.execute("select * from mini_apps where slug = %s", (slug,)).fetchone()
    if row is None:
        raise HTTPException(404, "no such app")
    return {**row, "public_url": public_url(slug) if row["public"] else None}


@router.get("/live/reservations")
def live_reservations(request: Request, arrival_from: str, arrival_to: str, status: str = ""):
    """Reservations arriving in a date range, live from Beds24, with guest contact details (owner only)."""
    c = ctx(request)
    statuses = [s for s in status.split(",") if s] or [s for s in ALL_STATUSES if s != "cancelled"]
    rows = c.pms.get_all("/bookings", propertyId=c.pms.property_id, arrivalFrom=arrival_from, arrivalTo=arrival_to,
                         status=statuses)
    rooms = room_types(c)
    return [{
        "id": b["id"], "guest": f"{b.get('firstName', '')} {b.get('lastName', '')}".strip(), "phone": b.get("phone"),
        "mobile": b.get("mobile"), "email": b.get("email"), "room": rooms.get(b.get("roomId"), {}).get("name"),
        "arrival": b.get("arrival"), "departure": b.get("departure"), "adults": b.get("numAdult"),
        "children": b.get("numChild"), "status": b.get("status"), "channel": b.get("channel") or "direct",
        "total": b.get("price") or 0, "deposit": b.get("deposit") or 0, "comments": b.get("comments"),
    } for b in sorted(rows, key=lambda b: (b.get("arrival") or "", b.get("id")))]


def availability(request: Request, arrival: str, departure: str, adults: int, children: int) -> dict:
    try:
        return check_availability(ctx(request), arrival, departure, adults, children)
    except ToolError as e:
        raise HTTPException(400, str(e))


@router.get("/live/availability")
def live_availability(request: Request, arrival: str, departure: str, adults: int = 2, children: int = 0):
    return availability(request, arrival, departure, adults, children)


@public.get("/api/availability")
def public_availability(request: Request, arrival: str, departure: str, adults: int = 2, children: int = 0):
    """Which cabins are free and their price for the stay; no booking or guest data."""
    out = availability(request, arrival, departure, adults, children)
    out["available"] = [{k: r[k] for k in ("name", "max_guests", "beds", "total_price", "nightly_average")}
                        for r in out["available"]]
    out["book_url"] = ctx(request).hotel.facts["property"].get("booking_portal")
    return out


@public.get("/api/info")
def public_hotel_info(request: Request):
    return public_info(ctx(request).hotel)


@public.get("/{slug}", response_class=HTMLResponse)
def public_page(request: Request, slug: str):
    with ctx(request).db.connection() as conn:
        row = conn.execute("select html from mini_apps where slug = %s and public", (slug,)).fetchone()
    if row is None:
        raise HTTPException(404, "page not found")
    return HTMLResponse(with_bridge(row["html"], PUBLIC_BRIDGE),
                        headers={"Content-Security-Policy": PUBLIC_CSP, "X-Content-Type-Options": "nosniff",
                                 "Referrer-Policy": "no-referrer"})
