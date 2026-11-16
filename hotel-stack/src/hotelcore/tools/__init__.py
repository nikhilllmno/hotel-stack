"""Guest-agent tools. Definitions: hotels/<id>/tools.yaml. Implementations: one module per tool."""

from hotelcore.tools.context import ToolContext, ToolError
from hotelcore.tools.registry import load_specs, run_tool, specs_for

__all__ = ["ToolContext", "ToolError", "load_specs", "run_tool", "specs_for"]
