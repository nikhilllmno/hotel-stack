"""Create Doss's Composio Tool Router session (MCP) and store its URL/headers in Doss's Hermes .env.

Run: uv run --with composio python scripts/composio_session.py /Users/nikhil/hermes/hotels/demo-hotel/.env
Apps: Gmail, Google Calendar, Sheets, Drive. Destructive tools (delete email/file/reply) are off;
everything else that changes something asks the owner in the chat (Hermes: trust untrusted + Composio's hints).
Values are written to the .env, never printed.
"""

import re
import sys
from pathlib import Path

from composio import Composio

# google_business_profile needs its own Google OAuth app (Composio has no managed auth for it): added later.
TOOLKITS = ["gmail", "googlecalendar", "googlesheets", "googledrive"]
# Direct tools (not Composio's meta executor) so Hermes sees each tool's own read/write hint: reads run freely, writes
# ask the owner in the chat. Curated: no deletes, no sharing/permissions, no account settings.
TOOLS = {
    "gmail": ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
              "GMAIL_LIST_THREADS", "GMAIL_LIST_LABELS", "GMAIL_GET_ATTACHMENT", "GMAIL_GET_PROFILE",
              "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "GMAIL_ADD_LABEL_TO_EMAIL"],
    "googlecalendar": ["GOOGLECALENDAR_EVENTS_LIST", "GOOGLECALENDAR_EVENTS_GET", "GOOGLECALENDAR_FIND_EVENT",
                       "GOOGLECALENDAR_FIND_FREE_SLOTS", "GOOGLECALENDAR_LIST_CALENDARS",
                       "GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_PATCH_EVENT"],
    "googlesheets": ["GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_GET_SPREADSHEET_INFO", "GOOGLESHEETS_GET_SHEET_NAMES",
                     "GOOGLESHEETS_VALUES_GET", "GOOGLESHEETS_BATCH_GET", "GOOGLESHEETS_UPDATE_VALUES_BATCH",
                     "GOOGLESHEETS_CREATE_SPREADSHEET_ROW", "GOOGLESHEETS_CREATE_GOOGLE_SHEET1"],
    "googledrive": ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_LIST_FILES", "GOOGLEDRIVE_FIND_FOLDER", "GOOGLEDRIVE_DOWNLOAD_FILE",
                    "GOOGLEDRIVE_UPLOAD_FILE", "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", "GOOGLEDRIVE_CREATE_FOLDER"],
}
USER_ID = "contigo-owner"  # the hotel owner's Composio user: connected accounts are tied to this id


def set_env(text: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    return re.sub(rf"^{key}=.*$", line, text, flags=re.M) if re.search(rf"^{key}=", text, re.M) else text.rstrip("\n") + f"\n{line}\n"


def main(env_path: str) -> None:
    env = Path(env_path)
    text = env.read_text()
    api_key = re.search(r"^COMPOSIO_API_KEY=(.*)$", text, re.M).group(1).strip().strip('"')
    session = Composio(api_key=api_key).sessions.create(
        user_id=USER_ID, toolkits=TOOLKITS, tools=TOOLS, tags={"disable": ["destructiveHint"]},
        session_preset="direct_tools", manage_connections=True, sandbox={"enable": False}, mcp=True)
    headers = dict(session.mcp.headers or {})
    text = set_env(text, "COMPOSIO_MCP_URL", session.mcp.url)
    for name, value in headers.items():
        text = set_env(text, "COMPOSIO_MCP_H_" + re.sub(r"[^A-Z0-9]", "_", name.upper()), value)
    text = set_env(text, "COMPOSIO_SESSION_ID", getattr(session, "session_id", "") or getattr(session, "id", ""))
    env.write_text(text)
    print(f"session for {USER_ID}: {len(TOOLKITS)} toolkits; wrote COMPOSIO_MCP_URL and headers {sorted(headers)} to {env}")


if __name__ == "__main__":
    main(sys.argv[1])
