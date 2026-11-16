"""Assemble an agent's system prompt: prompts/<channel>/*.md (filename order) + that channel's policies + kb topic list.

Placeholders: {{facts.x}} from facts.yaml; {{today}} and {{caller_number}} are filled per channel:
voice gets Vapi call-time variables (Vapi fills them when the call starts), text gets real values per guest.
"""

from hotelcore.config import HotelConfig, load_docs
from hotelcore.render import render


def vapi_variables(hotel: HotelConfig) -> dict[str, str]:
    tz = hotel.facts["property"]["time_zone"]
    return {
        "{{today}}": '{{"now" | date: "%A, %B %d, %Y", "' + tz + '"}}',
        "{{caller_number}}": "{{customer.number}}",
    }


def build_prompt(hotel: HotelConfig, channel: str, variables: dict[str, str]) -> str:
    sections = [render(doc.body, hotel.facts) for doc in load_docs(hotel.root / "prompts" / channel).values()]
    sections.append("# Hotel policies (follow these exactly)")
    sections += [hotel.render(doc) for doc in hotel.policies.values() if channel in doc.meta.get("used_by", [])]
    titles = "\n".join(f"- {d.title}" for d in hotel.kb.values())
    sections.append(f"# Knowledge base topics (use these exact titles with search_knowledge_base)\n{titles}")
    prompt = "\n\n".join(sections)
    for placeholder, value in variables.items():
        prompt = prompt.replace(placeholder, value)
    return prompt


def build_voice_prompt(hotel: HotelConfig) -> str:
    return build_prompt(hotel, "voice", vapi_variables(hotel))


def build_text_prompt(hotel: HotelConfig, today: str, guest_phone: str) -> str:
    return build_prompt(hotel, "text", {"{{today}}": today, "{{caller_number}}": guest_phone})
