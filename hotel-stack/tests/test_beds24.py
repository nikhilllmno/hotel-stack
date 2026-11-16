import json
import os

import httpx
import pytest

from hotelcore.pms.beds24 import BASE_URL, Beds24Client, Beds24Error


def fake_client(handler) -> Beds24Client:
    http = httpx.Client(base_url=BASE_URL, transport=httpx.MockTransport(handler))
    return Beds24Client(property_id=1, token="t", http=http)


def test_get_all_follows_pages():
    def handler(request):
        page = int(request.url.params["page"])
        return httpx.Response(200, json={"data": [{"id": page}], "pages": {"nextPageExists": page < 3}})

    assert [r["id"] for r in fake_client(handler).get_all("/bookings")] == [1, 2, 3]


def test_post_raises_on_item_failure_despite_http_201():
    def handler(request):
        return httpx.Response(201, json=[{"success": False, "errors": [{"message": "No availability"}]}])

    with pytest.raises(Beds24Error, match="No availability"):
        fake_client(handler).post("/bookings", [{"roomId": 1}])


def test_http_error_carries_beds24_message():
    def handler(request):
        return httpx.Response(401, json={"success": False, "error": "Token not valid"})

    with pytest.raises(Beds24Error, match="HTTP 401: Token not valid"):
        fake_client(handler).get_all("/bookings")


def test_missing_credential_is_explicit():
    with pytest.raises(Beds24Error, match="No Beds24 credential"):
        Beds24Client(property_id=1)._access_token()


@pytest.mark.skipif(not os.environ.get("BEDS24_REFRESH_TOKEN"), reason="live Beds24 credential not set")
def test_live_hotel_has_rooms():
    client = Beds24Client.from_env()
    hotel = client.get_all("/properties", id=client.property_id, includeAllRooms=True)[0]
    assert hotel["roomTypes"], json.dumps(hotel)[:200]
