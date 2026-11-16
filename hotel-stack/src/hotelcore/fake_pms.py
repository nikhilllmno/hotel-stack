"""In-memory Beds24 stand-in for evals: a few rooms, every date free, bookings kept in memory.
Lets evals create and modify bookings without touching the real hotel."""

import json

import httpx

from hotelcore.pms.beds24 import BASE_URL, Beds24Client

ROOMS = [
    {"id": 754949, "name": "Cabin 2", "maxPeople": 2, "nightly": 200},
    {"id": 755051, "name": "Cabin 4", "maxPeople": 4, "nightly": 275},
    {"id": 754950, "name": "Cabin 3", "maxPeople": 6, "nightly": 350},
    {"id": 754948, "name": "Cabin 1", "maxPeople": 10, "nightly": 500},
]
SEED_BOOKINGS = [
    {"id": 90001, "status": "confirmed", "channel": "direct", "roomId": 754949, "firstName": "Ann", "lastName": "Lee",
     "arrival": "2026-12-04", "departure": "2026-12-06", "numAdult": 2, "numChild": 0, "price": 400,
     "deposit": 200},
]


class FakeBeds24:
    def __init__(self):
        self.bookings = [dict(b) for b in SEED_BOOKINGS]
        self.next_id = 91000

    def handle(self, request: httpx.Request) -> httpx.Response:
        path, params = request.url.path.removeprefix("/api/v2"), request.url.params
        if request.method == "POST":
            return httpx.Response(201, json=[self._post(item) for item in json.loads(request.content)])
        if path == "/properties":
            data = [{"id": 1, "currency": "USD", "roomTypes": [{k: v for k, v in r.items() if k != "nightly"} for r in ROOMS]}]
        elif path == "/inventory/rooms/offers":
            data = self._offers(params)
        elif path == "/bookings":
            data = [b for b in self.bookings if "id" not in params or str(b["id"]) == params["id"]]
        else:
            data = []
        return httpx.Response(200, json={"data": data, "pages": {"nextPageExists": False}})

    def _offers(self, params) -> list[dict]:
        from datetime import date
        nights = (date.fromisoformat(params["departure"]) - date.fromisoformat(params["arrival"])).days
        guests = int(params.get("numAdults", 1)) + int(params.get("numChildren", 0))
        rooms = [r for r in ROOMS if r["maxPeople"] >= guests and ("roomId" not in params or str(r["id"]) == params["roomId"])]
        return [{"roomId": r["id"], "offers": [{"price": r["nightly"] * nights, "unitsAvailable": 1}]} for r in rooms]

    def _post(self, item: dict) -> dict:
        if "id" in item:
            booking = next(b for b in self.bookings if b["id"] == item["id"])
            booking.update({k: v for k, v in item.items() if k != "actions"})
            return {"success": True, "modified": {"id": item["id"]}}
        self.next_id += 1
        self.bookings.append({**{k: v for k, v in item.items() if k != "actions"}, "id": self.next_id, "channel": "direct"})
        return {"success": True, "new": {"id": self.next_id}}


def fake_client() -> tuple[Beds24Client, FakeBeds24]:
    fake = FakeBeds24()
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(fake.handle))
    return Beds24Client(property_id=1, token="eval", http=http), fake
