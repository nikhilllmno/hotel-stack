"""Claude tool loop shared by the SMS agent and the evals: call the model, run requested tools, repeat until it answers."""

import json

import anthropic

from hotelcore.tools import ToolContext, load_specs, run_tool, specs_for

AGENT_MODEL = "claude-opus-5-5"
MAX_STEPS = 8


def anthropic_tools(ctx: ToolContext, channel: str) -> list[dict]:
    return [{"name": s.name, "description": s.description, "input_schema": s.parameters}
            for s in specs_for(load_specs(ctx.hotel), channel)]


def run_turn(client: anthropic.Anthropic, system: str, tools: list, messages: list, ctx: ToolContext) -> list[tuple[str, dict, dict]]:
    """Appends assistant/tool messages to `messages`. Returns (tool, arguments, outcome) for each tool call this turn."""
    used = []
    for _ in range(MAX_STEPS):
        resp = client.beta.messages.create(
            model=AGENT_MODEL, max_tokens=4000, system=system, tools=tools, messages=messages,
            output_config={"effort": "low"}, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
        messages.append({"role": "assistant", "content": resp.content})
        calls = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not calls:
            return used
        results = []
        for call in calls:
            out = run_tool(call.name, call.input, ctx)
            used.append((call.name, call.input, out))
            content = json.dumps(out["result"]) if out["ok"] else out["error"]
            results.append({"type": "tool_result", "tool_use_id": call.id, "content": content, "is_error": not out["ok"]})
        messages.append({"role": "user", "content": results})
    return used


def text_of(content) -> str:
    return " ".join(b.text for b in content if getattr(b, "type", "") == "text").strip()
