"""Publish this hotel's voice agent to Vapi: create/update the assistant, attach the phone number.

Usage:
  uv run python -m hotelcore.publish [--dry-run] [--author NAME] [--note TEXT]
  uv run python -m hotelcore.publish --rollback VERSION_ID [--author NAME]
  uv run python -m hotelcore.publish --check      # compare live Vapi (and UI drafts) with the last publish; no changes
Publishing refuses when Vapi was edited outside the repo (live config differs, or a UI draft has new edits); fix that or
pass --force. A draft that is an unchanged copy of an old version (an open Vapi tab autosaving) is discarded automatically.
Every publish is saved to config_versions. Rollback restores that version's files, then publishes them as a new version.
Only touches the assistant named in voice.yaml and the hotel's own number.
"""

import argparse

import json
import os
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

from hotelcore.config import HotelConfig, load_hotel
from hotelcore.prompts import build_voice_prompt
from hotelcore.render import render
from hotelcore.db import connect
from hotelcore.tools import load_specs, specs_for
from hotelcore.versions import restore_files, save_version

REPO = Path(__file__).resolve().parents[2]
VAPI = "https://api.vapi.ai"


def vapi_client() -> httpx.Client:
    return httpx.Client(base_url=VAPI, timeout=30, headers={"Authorization": f"Bearer {os.environ['VAPI_API_KEY']}"})


def assistant_payload(hotel: HotelConfig, webhook: dict) -> dict:
    settings = yaml.safe_load((hotel.root / "voice.yaml").read_text())
    tools = [
        {
            "type": "function",
            "function": {"name": s.name, "description": s.description, "parameters": s.parameters},
            "server": webhook,
            **({"messages": [{"type": "request-start", "content": s.filler}]} if s.filler else {}),
        }
        for s in specs_for(load_specs(hotel), "voice")
    ]
    tools.append({"type": "endCall"})
    return {
        "name": settings["assistant_name"],
        "firstMessage": render(settings["first_message"], hotel.facts),
        "endCallMessage": render(settings["end_call_message"], hotel.facts),
        "model": {**settings["model"], "messages": [{"role": "system", "content": build_voice_prompt(hotel)}], "tools": tools},
        "voice": settings["voice"],
        "transcriber": settings["transcriber"],
        "startSpeakingPlan": settings["start_speaking"],
        "maxDurationSeconds": settings["max_duration_seconds"],
        "server": webhook,
        "serverMessages": ["end-of-call-report"],
    }


DRIFT_FIELDS = ("firstMessage", "endCallMessage", "voice", "transcriber")


def comparable(cfg: dict) -> dict:
    """The parts of an assistant config that decide behaviour, in a form that compares across Vapi and our snapshot."""
    model = cfg.get("model") or {}
    return {
        **{f: cfg.get(f) for f in DRIFT_FIELDS},
        "model": {k: model.get(k) for k in ("provider", "model", "temperature")},
        "prompt": ((model.get("messages") or [{}])[0]).get("content"),
        "tools": sorted(t.get("function", {}).get("name", t.get("type")) for t in model.get("tools") or []),
    }


def find_assistant(vapi: httpx.Client, name: str) -> dict | None:
    found = [a for a in vapi.get("/assistant", params={"limit": 1000}).raise_for_status().json() if a.get("name") == name]
    if len(found) > 1:
        raise SystemExit(f"{len(found)} assistants named {name!r}; fix by hand first")
    return found[0] if found else None


def fingerprint(cfg: dict) -> dict:
    """comparable() plus timing settings: enough to tell whether two configs are the same version."""
    return {**comparable(cfg), "maxDurationSeconds": cfg.get("maxDurationSeconds"),
            "waitSeconds": (cfg.get("startSpeakingPlan") or {}).get("waitSeconds")}


def stale_copy_of(draft: dict, versions: list[dict]) -> str | None:
    """The Vapi version a draft is an exact copy of (an old editor tab autosaving), or None if it has new edits."""
    return next((v["version"] for v in versions if fingerprint(v) == fingerprint(draft)), None)


def draft_problems(vapi: httpx.Client, assistant_id: str, discard_stale: bool) -> list[str]:
    """Report UI drafts. Stale copies of past versions hold nothing new: discarded when discard_stale, else reported as such."""
    drafts = vapi.get(f"/assistant/{assistant_id}/draft").raise_for_status().json()["results"]
    if not drafts:
        return []
    versions = vapi.get(f"/assistant/{assistant_id}/versions", params={"limit": 100}).raise_for_status().json()["results"]
    problems = []
    for d in drafts:
        who = f"Vapi UI draft by {d.get('createdBy')} (saved {d.get('updatedAt', '')[:16]}, on top of {d.get('baseVersion')})"
        copy = stale_copy_of(d, versions)
        if copy and discard_stale:
            vapi.delete(f"/assistant/{assistant_id}/draft/{d['id']}").raise_for_status()
            print(f"discarded stale draft: {who} was an unchanged copy of {copy}. Close any open Vapi dashboard tab.")
        elif copy:
            problems.append(f"{who} is an unchanged copy of old {copy}: safe to discard (an open Vapi tab autosaved it)")
        else:
            problems.append(f"{who} has NEW edits not in the repo")
    return problems


def drift(vapi: httpx.Client, assistant: dict, last_published: dict | None, discard_stale: bool = False) -> list[str]:
    """Differences between what is live / drafted in Vapi and what this repo last published."""
    problems = []
    if last_published:
        live, ours = comparable(assistant), comparable(last_published)
        problems += [f"live {k} differs from the last repo publish" for k in live if live[k] != ours[k]]
    return problems + draft_problems(vapi, assistant["id"], discard_stale)


def upsert_assistant(vapi: httpx.Client, payload: dict) -> dict:
    """PATCH the assistant with this exact name, or POST a new one. Never touches other assistants."""
    existing = find_assistant(vapi, payload["name"])
    if existing:
        return vapi.patch(f"/assistant/{existing['id']}", json=payload).raise_for_status().json()
    return vapi.post("/assistant", json=payload).raise_for_status().json()


def attach_number(vapi: httpx.Client, number: str, assistant_id: str, name: str) -> dict:
    """Point the hotel's number at the assistant; import it from Twilio the first time. SMS stays with hotel core."""
    existing = [p for p in vapi.get("/phone-number", params={"limit": 1000}).raise_for_status().json() if p.get("number") == number]
    if existing:
        return vapi.patch(f"/phone-number/{existing[0]['id']}", json={"assistantId": assistant_id}).raise_for_status().json()
    return vapi.post("/phone-number", json={
        "provider": "twilio", "number": number, "name": name, "assistantId": assistant_id, "smsEnabled": False,
        "twilioAccountSid": os.environ["TWILIO_ACCOUNT_SID"], "twilioAuthToken": os.environ["TWILIO_AUTH_TOKEN"],
    }).raise_for_status().json()


def main(args: argparse.Namespace) -> None:
    load_dotenv(REPO / ".env")
    root = REPO / "hotels" / os.environ.get("HOTEL_ID", "contigo-ranch")
    if args.rollback:
        with connect() as conn:
            restored = restore_files(conn, root, args.rollback)
        print(f"restored {len(restored)} files from version {args.rollback}")
        args.note = args.note or f"rollback to version {args.rollback}"
    hotel = load_hotel(root)
    webhook = {"url": f"{os.environ['PUBLIC_BASE_URL'].rstrip('/')}/vapi/webhook",
               "headers": {"x-vapi-secret": os.environ["VAPI_SERVER_SECRET"]}, "timeoutSeconds": 20}
    payload = assistant_payload(hotel, webhook)
    if args.dry_run:
        tools = [t.get("function", {}).get("name", t["type"]) for t in payload["model"]["tools"]]
        print(json.dumps({"name": payload["name"], "firstMessage": payload["firstMessage"], "tools": tools,
                          "prompt_chars": len(payload["model"]["messages"][0]["content"]), "webhook": webhook["url"]}, indent=1))
        return
    with vapi_client() as vapi:
        live = find_assistant(vapi, payload["name"])
        if live:
            with connect() as conn:
                last = conn.execute("select assistant from config_versions order by id desc limit 1").fetchone()
            problems = drift(vapi, live, last["assistant"] if last else None, discard_stale=not args.check)
            for p in problems:
                print("DRIFT:", p)
            if args.check:
                print("no drift" if not problems else f"{len(problems)} difference(s)")
                return
            if problems and not args.force:
                raise SystemExit("Vapi was changed outside the repo. Copy wanted changes into hotels/<id>/, "
                                 "discard the UI draft, then publish again (or pass --force to overwrite).")
        try:
            assistant = upsert_assistant(vapi, payload)
            phone = attach_number(vapi, os.environ["TWILIO_PHONE_NUMBER"], assistant["id"], payload["name"])
        except httpx.HTTPStatusError as e:
            raise SystemExit(f"Vapi {e.request.method} {e.request.url.path} -> {e.response.status_code}: {e.response.text[:800]}")
    stored = {**payload, "server": {"url": webhook["url"]}}  # never store the webhook secret
    for tool in stored["model"]["tools"]:
        tool.pop("server", None)
    with connect() as conn:
        version = save_version(conn, root, stored, args.author, args.note)
    print(f"version {version} | assistant {assistant['name']} {assistant['id']} | number {phone['number']} -> {phone.get('assistantId')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Publish this hotel's voice agent to Vapi")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", type=int, metavar="VERSION_ID")
    parser.add_argument("--author", default="human")
    parser.add_argument("--note", default="")
    parser.add_argument("--check", action="store_true", help="only report drift between Vapi and the last publish")
    parser.add_argument("--force", action="store_true", help="publish even if Vapi was edited outside the repo")
    main(parser.parse_args())
