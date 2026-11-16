"""Voice-agent evals: play scripted guest turns against the real prompt and tools (fake Beds24), grade with a judge.

Usage: uv run python -m hotelcore.evals [--channel voice|text] [name-substring]
Scenarios: hotels/<id>/evals/<channel>.yaml. Results print as a table and are saved to eval_runs when DATABASE_URL is set.
Note: the live voice model runs on Vapi (voice.yaml); evals use Claude to test the prompt and tools.
"""

import json
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
import yaml
from dotenv import load_dotenv
from pydantic import BaseModel

from hotelcore.claude_agent import anthropic_tools, run_turn, text_of
from hotelcore.config import HotelConfig, load_hotel
from hotelcore.fake_pms import fake_client
from hotelcore.prompts import build_text_prompt, build_voice_prompt, vapi_variables
from hotelcore.render import render
from hotelcore.tools import ToolContext

REPO = Path(__file__).resolve().parents[2]
JUDGE_MODEL = "claude-opus-5-5"
TEST_CALLER = "+12025550123"


class Verdict(BaseModel):
    passed: bool
    reason: str  # one sentence


def eval_prompt(hotel: HotelConfig, today: str, channel: str) -> str:
    if channel == "text":
        return build_text_prompt(hotel, today, TEST_CALLER)
    prompt = build_voice_prompt(hotel)
    liquid = vapi_variables(hotel)
    return prompt.replace(liquid["{{today}}"], today).replace(liquid["{{caller_number}}"], TEST_CALLER)


def tool_check(required: dict | None, used: list[tuple[str, dict]]) -> tuple[bool, str]:
    """Required tool called in the last turn with matching arguments (partial, case-insensitive for strings)."""
    if not required:
        return True, ""
    norm = lambda v: v.strip().lower() if isinstance(v, str) else v  # noqa: E731
    for name, args in used:
        if name == required["name"] and all(norm(args.get(k)) == norm(v) for k, v in (required.get("arguments") or {}).items()):
            return True, ""
    return False, f"expected {required['name']} {required.get('arguments') or ''}; got {[n for n, _ in used] or 'no tools'}"


def judge(client, case: dict, transcript: str, reply: str) -> Verdict:
    resp = client.messages.parse(
        model=JUDGE_MODEL, max_tokens=1000, output_config={"effort": "low"}, output_format=Verdict,
        system="You grade a hotel phone agent's final reply against an expectation. Be strict about MUST/MUST NOT; "
               "ignore wording, length and extra politeness.",
        messages=[{"role": "user", "content": f"Expectation:\n{case['expect']}\n\nConversation:\n{transcript}\n\nFinal reply:\n{reply}"}],
    )
    return resp.parsed_output if resp.stop_reason != "refusal" else Verdict(passed=False, reason="judge refused")


def run_case(case: dict, hotel: HotelConfig, system: str, channel: str) -> dict:
    client = anthropic.Anthropic()
    pms, _ = fake_client()
    ctx = ToolContext(hotel=hotel, pms=pms, data_dir=Path(tempfile.mkdtemp()), caller_phone=TEST_CALLER,
                      conversation_id=f"eval:{case['name']}", channel=channel)
    tools = anthropic_tools(ctx, channel)
    messages, lines, used = [], [], []
    for utterance in case["say"]:
        messages.append({"role": "user", "content": utterance})
        used = [(n, a) for n, a, _ in run_turn(client, system, tools, messages, ctx)]
        lines += [f"Guest: {utterance}", *(f"[tool {n} {json.dumps(a)}]" for n, a in used), f"Agent: {text_of(messages[-1]['content'])}"]
    reply = text_of(messages[-1]["content"])
    tool_ok, tool_reason = tool_check(case.get("tool"), used)
    verdict = judge(client, case, "\n".join(lines), reply)
    return {"name": case["name"], "channel": channel, "passed": tool_ok and verdict.passed, "tool_ok": tool_ok,
            "reason": tool_reason or verdict.reason, "reply": reply, "transcript": lines}


def load_cases(hotel: HotelConfig, channel: str, name_filter: str = "") -> list[dict]:
    text = render((hotel.root / "evals" / f"{channel}.yaml").read_text(), hotel.facts)
    return [c for c in yaml.safe_load(text) if name_filter.lower() in c["name"].lower()]


def run(hotel: HotelConfig, name_filter: str = "", channel: str = "voice") -> list[dict]:
    today = __import__("datetime").datetime.now(__import__("zoneinfo").ZoneInfo(hotel.facts["property"]["time_zone"]))
    system = eval_prompt(hotel, today.strftime("%A, %B %d, %Y"), channel)
    cases = load_cases(hotel, channel, name_filter)
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(lambda c: run_case(c, hotel, system, channel), cases))


def save(results: list[dict]) -> int:
    from psycopg.types.json import Jsonb
    from hotelcore.db import connect
    with connect() as conn:
        row = conn.execute("insert into eval_runs (total, passed, results) values (%s, %s, %s) returning id",
                           (len(results), sum(r["passed"] for r in results), Jsonb(results))).fetchone()
    return row["id"]


if __name__ == "__main__":
    load_dotenv(REPO / ".env")
    hotel = load_hotel(REPO / "hotels" / os.environ.get("HOTEL_ID", "contigo-ranch"))
    args = sys.argv[1:]
    channel = args[args.index("--channel") + 1] if "--channel" in args else "voice"
    rest = [a for i, a in enumerate(args) if a != "--channel" and (i == 0 or args[i - 1] != "--channel")]
    results = run(hotel, rest[0] if rest else "", channel)
    for r in results:
        print(f"{'PASS' if r['passed'] else 'FAIL'}  {r['name']:55}  {'' if r['passed'] else r['reason']}")
    print(f"\n{sum(r['passed'] for r in results)}/{len(results)} passed")
    if os.environ.get("DATABASE_URL"):
        print("saved eval_run", save(results))
