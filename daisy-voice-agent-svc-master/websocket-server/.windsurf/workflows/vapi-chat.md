---
name: vapi-chat-session-api
description: Chat with a Vapi assistant by name using the Vapi REST API. Use this skill whenever the user wants to send a message to a Vapi assistant, start a Vapi chat session, interact with a Vapi AI agent via chat, or test a Vapi assistant. Requires VAPI_API_KEY and CUSTOMER_NUMBER. Claude will resolve the assistant by name, create a session, send a message, and return the reply. Trigger on any mention of "Vapi", "chat with assistant", "send message to Vapi", or when the user provides a Vapi assistant name and a message to send. The Vapi agent should be already configured to send the session.created event for this to work.
---

# Vapi Chat – Generic Chat by Assistant Name

Chat with any Vapi assistant by name via the Vapi REST API.

**Base URL:** `https://api.vapi.ai`  
**Auth:** `Authorization: Bearer $VAPI_API_KEY`

## Required Inputs

| Variable                 | Required | Description                                          |
|--------------------------|----------|------------------------------------------------------|
| `VAPI_API_KEY`           | ✅        | Vapi API key (from the .env file or user)           |
| `CUSTOMER_NUMBER`        | ✅        | Customer phone number. Defaults to `+14083205093`   |
| `CHAT_INPUT`             | ✅        | The message to send to the assistant                |
| `ASSISTANT_NAME`         | ✅        | Assistant name to look up (case-insensitive)        |
| `ASSISTANT_PHONE_NUMBER` | ❌        | Optional override; defaults to `+17603592703`       |

## Flow

1. **List assistants** → First, list all the assistants. Then find the one matching `ASSISTANT_NAME` (case-insensitive) → extract its `id`
2. **Create a session** → POST to `/session` with `assistantId` and `variableValues` → extract session `id`
3. **Send message** → POST to `/chat` (with `--max-time 60`) with `sessionId` and `input` → return `output[0].content` (fallback: `messages[-1].content`)

---

## Step 1 — List Assistants & Resolve by Name

```bash
ASSISTANT_ID=$(curl -s -X GET "https://api.vapi.ai/assistant" \
  -H "Authorization: Bearer $VAPI_API_KEY" | \
  jq -r --arg name "$ASSISTANT_NAME" \
    '.[] | select((.name | ascii_downcase) == ($name | ascii_downcase)) | .id')

echo "Assistant ID: $ASSISTANT_ID"
```

If `ASSISTANT_ID` is empty, the assistant name didn't match. List all names to help the user:

```bash
curl -s -X GET "https://api.vapi.ai/assistant" \
  -H "Authorization: Bearer $VAPI_API_KEY" | jq -r '.[].name'
```

---

## Step 2 — Create Session

```bash
SESSION_PAYLOAD=$(jq -n \
  --arg assistant_id "$ASSISTANT_ID" \
  --arg customer_number "$CUSTOMER_NUMBER" \
  --arg assistant_phone "${ASSISTANT_PHONE_NUMBER:-+17603592703}" \
  '{
    assistantId: $assistant_id,
    assistantOverrides: {
      variableValues: {
        customer: { number: $customer_number },
        assistant_phone_number: $assistant_phone,
        session_type: "CHAT"
      }
    }
  }')

SESSION_ID=$(curl -s -X POST "https://api.vapi.ai/session" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$SESSION_PAYLOAD" | jq -r '.id')

echo "Session ID: $SESSION_ID"
```

> **Note:** Use `jq -n` to build the JSON payload safely — this avoids escaping issues when variables contain special characters or quotes.

---

## Step 3 — Send Message & Get Reply

> **Note:** The `/chat` endpoint can take 10–30+ seconds when the assistant invokes tools (e.g., knowledge base queries). Always use `--max-time 60` to avoid silent timeouts. As a fallback, extract from `.messages[-1].content`.

```bash
CHAT_PAYLOAD=$(jq -n \
  --arg session_id "$SESSION_ID" \
  --arg input "$CHAT_INPUT" \
  '{ sessionId: $session_id, input: $input }')

CHAT_RESPONSE=$(curl -s --max-time 60 -X POST "https://api.vapi.ai/chat" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$CHAT_PAYLOAD")

# Primary extraction
REPLY=$(echo "$CHAT_RESPONSE" | jq -r '.output[0].content // empty')

# Fallback: extract from messages array if output is empty
if [ -z "$REPLY" ]; then
  REPLY=$(echo "$CHAT_RESPONSE" | jq -r '.messages[-1].content // empty')
fi

echo "$REPLY"
```

---

## Full Example (All Steps Combined)

```bash
# Set variables
ASSISTANT_NAME="Kern Lodge Dev Hotel"
CUSTOMER_NUMBER="+14083205093"
CHAT_INPUT="Do you have any rooms available this weekend?"
# ASSISTANT_PHONE_NUMBER="+17603592703"  # optional override

# Step 1: Resolve assistant ID by name
ASSISTANT_ID=$(curl -s -X GET "https://api.vapi.ai/assistant" \
  -H "Authorization: Bearer $VAPI_API_KEY" | \
  jq -r --arg name "$ASSISTANT_NAME" \
    '.[] | select((.name | ascii_downcase) == ($name | ascii_downcase)) | .id')

# Step 2: Create session
SESSION_ID=$(curl -s -X POST "https://api.vapi.ai/session" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg assistant_id "$ASSISTANT_ID" \
    --arg customer_number "$CUSTOMER_NUMBER" \
    --arg assistant_phone "${ASSISTANT_PHONE_NUMBER:-+17603592703}" \
    '{
      assistantId: $assistant_id,
      assistantOverrides: {
        variableValues: {
          customer: { number: $customer_number },
          assistant_phone_number: $assistant_phone,
          session_type: "CHAT"
        }
      }
    }')" | jq -r '.id')

# Step 3: Send message and get reply (with timeout and fallback)
CHAT_PAYLOAD=$(jq -n \
  --arg session_id "$SESSION_ID" \
  --arg input "$CHAT_INPUT" \
  '{ sessionId: $session_id, input: $input }')

CHAT_RESPONSE=$(curl -s --max-time 60 -X POST "https://api.vapi.ai/chat" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$CHAT_PAYLOAD")

REPLY=$(echo "$CHAT_RESPONSE" | jq -r '.output[0].content // empty')
[ -z "$REPLY" ] && REPLY=$(echo "$CHAT_RESPONSE" | jq -r '.messages[-1].content // empty')

echo "$REPLY"
```

---

## Error Handling

- If `ASSISTANT_ID` is empty → assistant name not found. List all assistant names and ask user to confirm the correct one.
- If `SESSION_ID` is empty or null → session creation failed. Check that `VAPI_API_KEY` is valid and `CUSTOMER_NUMBER` is in E.164 format (e.g. `+14083205093`).
- If `REPLY` is empty or null → chat failed or assistant returned no output. The `/chat` endpoint can be slow when tool calls are involved (10–30s+). Check that `SESSION_ID` is valid. The skill automatically falls back to `.messages[-1].content` if `.output[0].content` is empty.
- Always use `jq` to construct JSON payloads — never use shell string interpolation for JSON, as special characters in variables will break the request.

## Dependencies

- `curl` — for HTTP requests
- `jq` — for JSON parsing and safe payload construction