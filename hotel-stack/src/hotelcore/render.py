"""Fill {{facts.path}} placeholders from a hotel's facts."""

import re

PLACEHOLDER = re.compile(r"\{\{\s*facts\.([A-Za-z0-9_.]+)\s*\}\}")


class MissingFact(KeyError):
    """A template references a fact that does not exist."""


def lookup(facts: dict, path: str):
    """Value at a dotted path like 'checkin.time'."""
    value = facts
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            raise MissingFact(f"facts.{path}")
        value = value[key]
    return value


def render(text: str, facts: dict) -> str:
    """Replace every placeholder; raise MissingFact on the first unknown path."""
    return PLACEHOLDER.sub(lambda m: str(lookup(facts, m.group(1))), text)


def placeholders(text: str) -> list[str]:
    """Dotted fact paths referenced in a template."""
    return PLACEHOLDER.findall(text)
