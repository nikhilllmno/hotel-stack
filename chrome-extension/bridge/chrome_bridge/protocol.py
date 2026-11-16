"""Wire contract with the extension. Mirrors chrome-extension/extension/src/shared/protocol.ts: change both together."""

from dataclasses import dataclass
from typing import Any, Literal

PROTOCOL_VERSION = 1

CommandName = Literal["tabs", "use_tab", "navigate", "snapshot", "screenshot", "act", "act_with_approval", "wait"]
Status = Literal["done", "needs_approval", "blocked"]


def command(id: str, name: CommandName, args: dict[str, Any]) -> dict[str, Any]:
    """bridge -> extension. `approved` is true only for act_with_approval: Hermes already asked the owner."""
    return {"type": "command", "id": id, "name": name, "args": args, "approved": name == "act_with_approval"}


@dataclass(frozen=True)
class Result:
    """extension -> bridge answer to one command."""

    ok: bool
    status: Status | None = None
    text: str = ""
    image_data: str | None = None  # base64
    image_mime: str | None = None
    error: str = ""

    @classmethod
    def from_message(cls, msg: dict[str, Any]) -> "Result":
        image = msg.get("image") or {}
        return cls(
            ok=bool(msg.get("ok")),
            status=msg.get("status"),
            text=str(msg.get("text") or ""),
            image_data=image.get("data"),
            image_mime=image.get("mime"),
            error=str(msg.get("error") or ""),
        )
