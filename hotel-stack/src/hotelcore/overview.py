"""A plain-language map of the hotel's agents, so Doss can turn an owner's everyday words ("text them the booking
link", "Danny should mention the pool") into the right files, tools and templates. The owner never has to know
internal names like send_text or booking_link."""

import yaml

from hotelcore.config import HotelConfig, parse_doc
from hotelcore.render import render
from hotelcore.tools import load_specs

CHANNELS = {"voice": "phone calls", "text": "text messages"}

WHERE_THINGS_GO = {
    "a price, time, phone number, link, address or any other value": "facts.yaml (every prompt, text and KB topic reads it)",
    "something guests ask about (amenities, area, policies to explain)": "kb/<topic>.md (Danny searches these on calls and texts)",
    "how Danny behaves on calls (steps, tone, what to say)": "prompts/voice/*.md",
    "how Danny behaves by text": "prompts/text/*.md",
    "a rule Danny must always follow": "policies/*.md",
    "the wording of a text Danny sends, or a new kind of text": "sms_templates.yaml (a new template is offered to Danny automatically)",
    "turning one of Danny's abilities on/off for calls or texts, or how it is described to him": "tools.yaml",
    "Danny's voice, greeting, model or call length": "voice.yaml",
    "a test conversation that proves Danny handles something": "evals/voice.yaml (calls) or evals/text.yaml (texts)",
    "a brand-new ability (needs code)": "src/hotelcore/tools/ + tools.yaml + tests (propose as code)",
}


def flatten(d: dict, prefix: str = "") -> dict[str, str]:
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, f"{key}."))
        else:
            text = str(v)
            out[key] = text if len(text) <= 160 else text[:157] + "..."
    return out


def headings(text: str) -> list[str]:
    return [line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("#")]


def agent_overview(hotel: HotelConfig) -> dict:
    root, rel = hotel.root, f"hotels/{hotel.hotel_id}"
    templates = yaml.safe_load((root / "sms_templates.yaml").read_text())
    voice = yaml.safe_load((root / "voice.yaml").read_text())
    prompts = [
        {"path": f"{rel}/{p.relative_to(root)}", "for": CHANNELS[p.parent.name], "sections": headings(parse_doc(p).body)}
        for p in sorted((root / "prompts").glob("*/*.md"))
    ]
    evals = {ch: [c["name"] for c in yaml.safe_load((root / "evals" / f"{ch}.yaml").read_text()) or []]
             for ch in ("voice", "text") if (root / "evals" / f"{ch}.yaml").exists()}
    return {
        "hotel": hotel.facts.get("property", {}).get("name", hotel.hotel_id),
        "agent": hotel.facts.get("agent", {}).get("name", "Danny"),
        "files_root": rel,
        "where_things_go": {k: f"{rel}/{v}" if not v.startswith("src/") else v for k, v in WHERE_THINGS_GO.items()},
        "what_danny_can_do": [
            {"internal_name": s.name, "on": [CHANNELS[c] for c in s.channels], "what_it_does": s.description}
            for s in load_specs(hotel).values()
        ],
        "texts_danny_can_send": [
            {"internal_name": name, "when": t["description"],
             "sent_by": "core automatically" if t.get("internal") else "Danny, when it fits the conversation",
             "example": " ".join(render(t["text"], hotel.facts).split())}
            for name, t in templates.items()
        ],
        "instructions": prompts,
        "rules": [d.title for d in hotel.policies.values()],
        "rule_files": sorted(f"{rel}/policies/{p.name}" for p in (root / "policies").glob("*.md")),
        "knowledge_base": [{"title": d.title, "id": d.id} for d in hotel.kb.values()],
        "kb_files": sorted(f"{rel}/kb/{p.name}" for p in (root / "kb").glob("*.md")),
        "facts": flatten(hotel.facts),
        "test_scenarios": evals,
        "voice": {"assistant": voice.get("assistant_name"), "voice": voice.get("voice"), "model": voice.get("model", {}).get("model"),
                  "greeting": render(voice.get("first_message", ""), hotel.facts), "max_call_seconds": voice.get("max_duration_seconds")},
    }
