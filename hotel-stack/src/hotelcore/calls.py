"""Store Vapi end-of-call reports in Postgres and analyze them with Claude.

Usage:
  uv run python -m hotelcore.calls backfill      # load data/calls.jsonl + data/messages.jsonl into Postgres
  uv run python -m hotelcore.calls analyze       # analyze calls that have no summary yet
"""

import json
import sys
from typing import Literal

import anthropic
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from hotelcore.db import REPO, connect

ANALYSIS_MODEL = "claude-opus-5-5"


class CallAnalysis(BaseModel):
    summary: str  # 2-3 sentences for the hotel owner
    intent: Literal["new_booking", "existing_booking", "modify_booking", "cancel_booking", "question", "complaint", "other"]
    outcome: Literal["booked", "modified", "quoted_no_booking", "message_taken", "answered", "abandoned", "other"]
    sentiment: Literal["positive", "neutral", "negative"]


def booking_made(messages: list[dict]) -> tuple[int | None, float | None]:
    """Booking id and total from a successful create_reservation result on this call."""
    for m in messages:
        if m.get("role") == "tool_call_result" and m.get("name") == "create_reservation":
            try:
                result = json.loads(m.get("result") or "")
            except json.JSONDecodeError:
                continue  # an error sentence, not a booking
            return result.get("booking_id"), result.get("total_price")
    return None, None


def call_row(report: dict) -> dict:
    artifact = report.get("artifact") or {}
    messages = artifact.get("messages") or report.get("messages") or []
    booking_id, amount = booking_made(messages)
    return {
        "id": report["call"]["id"],
        "started_at": report.get("startedAt"),
        "ended_at": report.get("endedAt"),
        "duration_s": report.get("durationSeconds"),
        "caller_phone": (report.get("customer") or report["call"].get("customer") or {}).get("number"),
        "ended_reason": report.get("endedReason"),
        "cost_usd": report.get("cost"),
        "recording_url": artifact.get("recordingUrl") or report.get("recordingUrl"),
        "transcript": artifact.get("transcript") or report.get("transcript"),
        "messages": Jsonb([m for m in messages if m.get("role") != "system"]),
        "booking_id": booking_id,
        "booking_amount": amount,
        "raw": Jsonb(report),
    }


def save_call(conn, report: dict) -> str:
    row = call_row(report)
    cols = list(row)
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "id")
    conn.execute(
        f"insert into calls ({', '.join(cols)}) values ({', '.join('%(' + c + ')s' for c in cols)}) "
        f"on conflict (id) do update set {updates}",
        row,
    )
    return row["id"]


def analyze(transcript: str, ended_reason: str) -> CallAnalysis:
    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=ANALYSIS_MODEL,
        max_tokens=2000,
        output_config={"effort": "low"},
        system=("You analyze phone calls to a ranch hotel's AI front desk for the hotel owner. "
                "Summarize in 2-3 plain sentences: what the caller wanted, what the agent did, and anything the team must follow up."),
        messages=[{"role": "user", "content": f"Ended reason: {ended_reason}\n\nTranscript:\n{transcript}"}],
        output_format=CallAnalysis,
    )
    if response.stop_reason == "refusal":
        return CallAnalysis(summary="Analysis unavailable.", intent="other", outcome="other", sentiment="neutral")
    return response.parsed_output


def analyze_and_store(conn, call_id: str) -> CallAnalysis | None:
    row = conn.execute("select transcript, ended_reason from calls where id = %s", (call_id,)).fetchone()
    if not row or not row["transcript"]:
        return None
    a = analyze(row["transcript"], row["ended_reason"] or "")
    conn.execute(
        "update calls set summary=%s, intent=%s, outcome=%s, sentiment=%s, analyzed_at=now() where id=%s",
        (a.summary, a.intent, a.outcome, a.sentiment, call_id),
    )
    return a


def save_message(conn, record: dict) -> None:
    conn.execute(
        "insert into team_messages (created_at, channel, call_id, caller_phone, guest_name, callback_phone, reason) "
        "values (%(at)s, %(channel)s, %(conversation_id)s, %(caller_phone)s, %(guest_name)s, %(callback_phone)s, %(reason)s)",
        record,
    )


def save_tool_call(conn, call_id: str, channel: str, name: str, args: dict, out: dict) -> None:
    conn.execute(
        "insert into tool_calls (call_id, channel, name, arguments, ok, result, error, ms) values (%s,%s,%s,%s,%s,%s,%s,%s)",
        (call_id, channel, name, Jsonb(args), out["ok"], Jsonb(out.get("result")), out.get("error"), out["ms"]),
    )


def backfill(conn) -> None:
    for line in (REPO / "data" / "calls.jsonl").read_text().splitlines():
        print("call", save_call(conn, json.loads(line)))
    existing = conn.execute("select count(*) as n from team_messages").fetchone()["n"]
    if existing == 0:
        for line in (REPO / "data" / "messages.jsonl").read_text().splitlines():
            save_message(conn, json.loads(line))


if __name__ == "__main__":
    with connect() as conn:
        if sys.argv[1:] == ["backfill"]:
            backfill(conn)
        elif sys.argv[1:] == ["analyze"]:
            for r in conn.execute("select id from calls where analyzed_at is null").fetchall():
                a = analyze_and_store(conn, r["id"])
                print(r["id"][:8], a.intent if a else "-", a.outcome if a else "-", "|", a.summary if a else "no transcript")
