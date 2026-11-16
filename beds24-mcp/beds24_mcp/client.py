"""Beds24 API v2 client scoped to one property (read-only use)."""

import os
import time

import httpx
from mcp.server.mcpserver.exceptions import ToolError

BASE_URL = "https://beds24.com/api/v2"


def _check(response: httpx.Response) -> dict:
    """Return the JSON body, or raise a ToolError carrying Beds24's own error text."""
    if response.is_error:
        detail = response.json().get("error", response.text[:200]) if response.content else ""
        raise ToolError(f"Beds24 {response.request.url.path} returned HTTP {response.status_code}: {detail}")
    return response.json()


class Beds24Client:
    """Holds the credential, refreshes the access token, and pages through list endpoints.

    Accepts either a long-life token (BEDS24_TOKEN, read-only by Beds24 design)
    or a refresh token (BEDS24_REFRESH_TOKEN) exchanged for short-lived access tokens.
    """

    def __init__(self, property_id: int, token: str = "", refresh_token: str = ""):
        self.property_id = property_id
        self._refresh_token = refresh_token
        self._token = token
        self._expires_at = float("inf") if token else 0.0
        self._http = httpx.Client(base_url=BASE_URL, timeout=20)

    @classmethod
    def from_env(cls) -> "Beds24Client":
        return cls(
            property_id=int(os.environ["BEDS24_PROPERTY_ID"]),
            token=os.environ.get("BEDS24_TOKEN", ""),
            refresh_token=os.environ.get("BEDS24_REFRESH_TOKEN", ""),
        )

    def _access_token(self) -> str:
        if time.time() < self._expires_at - 60:
            return self._token
        if not self._refresh_token:
            raise ToolError("No Beds24 credential set: add BEDS24_REFRESH_TOKEN or BEDS24_TOKEN to beds24-mcp/.env")
        body = _check(self._http.get("/authentication/token", headers={"refreshToken": self._refresh_token}))
        self._token, self._expires_at = body["token"], time.time() + body["expiresIn"]
        return self._token

    def post(self, path: str, items: list[dict]) -> list[dict]:
        """POST a JSON array. Beds24 can return HTTP 201 with per-item failures, so check each item."""
        results = _check(self._http.post(path, json=items, headers={"token": self._access_token()}))
        failed = [r for r in results if not r.get("success")]
        if failed:
            messages = [e.get("message", "") for r in failed for e in r.get("errors", [])]
            raise ToolError(f"Beds24 rejected the change: {'; '.join(messages) or failed}")
        return results

    def get_all(self, path: str, **params) -> list[dict]:
        """GET every page of a list endpoint. Unset (None) params are dropped."""
        query = {k: v for k, v in params.items() if v is not None}
        rows, page = [], 1
        while True:
            body = _check(self._http.get(path, params={**query, "page": page}, headers={"token": self._access_token()}))
            rows.extend(body.get("data", []))
            if not body.get("pages", {}).get("nextPageExists"):
                return rows
            page += 1
