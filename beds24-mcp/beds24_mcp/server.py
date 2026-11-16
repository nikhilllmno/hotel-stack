"""Beds24 MCP server for Doss, the hotel owner agent. Runs over stdio."""

from beds24_mcp import read_tools, write_tools  # noqa: F401  (registers the tools)
from beds24_mcp.app import mcp

if __name__ == "__main__":
    mcp.run()
