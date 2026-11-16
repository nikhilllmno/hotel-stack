# Sister-hotel availability (cross-sell)

When a hotel can't fit the guest (sold out, or the party is too big for any room), the agent can check availability and prices at the hotel's sister hotels in the same call. Daisy finds the hotel from the assistant phone number, so every other tool only sees the hotel being called. This tool is the one exception: it reads the calling hotel's list of sister hotels and asks each sister hotel's own PMS.

It is **read-only**. It never holds rooms, creates sessions or reservations at the sister hotel, or sends SMS. Booking at a sister hotel isn't supported yet (see [Not supported yet: booking at a sister hotel](#not-supported-yet-booking-at-a-sister-hotel)), so the agent gives the guest the sister hotel's website or phone number, or transfers the call.

Used by: Giri Group (first version, #1754) and Gather Hospitality (5 Cloudbeds hotels in Blowing Rock / Boone, NC).

## Configuration

Per hotel, in `hotel_configurations.cross_sell_configuration` (jsonb). Set it with the hotel-configuration API like any other setting:

```http
PUT /api/hotel/<calling hotel id>/configuration
Authorization: Bearer <admin or superadmin JWT>
Content-Type: application/json

{
  "cross_sell_configuration": {
    "enabled": true,
    "check_all_sister_properties": true,
    "sister_properties": [
      {
        "hotel_id": "<Daisy hotels.id of The Haven Hotel>",
        "name": "The Haven Hotel",
        "distance_miles": 0.5,
        "phone_number": "+1 828-555-0100",
        "website": "https://havenhotel.co"
      }
    ]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `enabled` | yes | `false` turns the tool off without deleting the list. |
| `sister_properties` | yes | Up to 10 hotels, **in the order the agent should offer them** (nearest or best fit first). The same `hotel_id` can't be listed twice. |
| `sister_properties[].hotel_id` | yes | The sister hotel's Daisy `hotels.id` (uuid). The sister hotel must already be onboarded in Daisy with working PMS credentials. Its PMS can differ from the calling hotel's. |
| `sister_properties[].name` | yes | The name the agent says. |
| `sister_properties[].website` | no | `http(s)` URL the agent gives the guest. If it's not set, Daisy uses the sister hotel's `hotels.url`. |
| `sister_properties[].phone_number` | no | The sister hotel's guest-facing number, for the agent to read out or transfer to. Not its Daisy assistant number. |
| `sister_properties[].distance_miles` | no | Said in the summary ("0.5 miles away"). |
| `check_all_sister_properties` | no | `true`: check every sister hotel at once and return all of them (Gather). Missing or `false`: the original check, unchanged (Giri). See [The two modes](#the-two-modes). |
| `timeout_ms` | no | Time limit for each sister hotel's PMS check, 1000–15000. Default 8000. Used only with `check_all_sister_properties: true`. |

### The two modes

| | `check_all_sister_properties: true` | Missing or `false` (default) |
|---|---|---|
| Order | Every sister hotel at once, results in configured order | One at a time, in configured order |
| Stops | Never: every sister hotel is returned | At the first sister hotel with a bookable room |
| Cloudbeds sister hotels | `getRoomAvailabilityWithQuoteLiteV2` (`getAvailableRoomTypes`) | `getRoomAvailabilityWithQuoteLite` |
| Time limit | `timeout_ms` per hotel | None |
| Failed or slow hotel | Error entry; the others are still returned | Error entry (failures only); the next hotel is checked |
| `website`, `date_correction_details` | Returned | Not returned |
| `message` | Lists every available sister hotel, says which couldn't be checked, and that rooms there can't be booked on this call | `<hotel> (<distance> miles away) has availability for your dates.` |
| Calling hotel listed as its own sister | Skipped | Checked like any other |

The default mode is the first version (#1754) exactly as Giri's prompt expects it, so turning cross-sell on for a new hotel group never changes another group's behaviour.

Notes:
- The configuration only applies one way. To let The Haven's agent offer The 1850, set it on The Haven too.
- A PUT replaces the whole `cross_sell_configuration`: send the full list each time. `null` clears it. A PUT that doesn't mention `cross_sell_configuration` leaves it unchanged.
- With `check_all_sister_properties: true`, a hotel listed as its own sister is skipped.

## The tool route

`POST /daisy/sister-property-availability`, with the same middleware as the other agent tools: `x-api-key`, `caller_phone_number`, `assistant_phone_number` (or `business_id`), `session_type`, and an active session for the caller at the calling hotel.

Request body:

| Field | Required | |
|---|---|---|
| `start_date`, `end_date` | yes | `YYYY-MM-DD` check-in and check-out |
| `num_adults` | yes | |
| `num_children`, `num_pets` | no | default 0 |

What Daisy does with `check_all_sister_properties: true` (without it, see [The two modes](#the-two-modes)):
1. Reads the calling hotel's `cross_sell_configuration`. If it's missing, disabled or empty, Daisy returns `cross_sell_available: false` with the message `Cross-sell is not configured for this hotel.`
2. Checks every sister hotel **in parallel**, each with its own time limit (`timeout_ms`). For each one it calls that hotel's own lite availability, the same code as the hotel's own availability tool: `getRoomAvailabilityWithQuoteLiteV2` for Cloudbeds (the `getAvailableRoomTypes` path behind `/daisy/availability-lite-v2`) and `getRoomAvailabilityWithQuoteLite` for every other PMS. The sister hotel's own timezone, date rules, taxes, fees, deposit policy and occupancy limits apply.
3. A sister hotel whose check fails (PMS error, missing credentials, hotel not in Daisy) or times out becomes an entry with `available: false` and an `error`. The other hotels are still returned.

Response (`200`):

```json
{
  "cross_sell_available": true,
  "message": "The Haven Hotel (0.5 miles away, https://havenhotel.co) has availability for your dates. Rooms at a sister property can't be booked on this call: give the guest its website or phone number.",
  "results": [
    {
      "hotel_name": "The Haven Hotel",
      "website": "https://havenhotel.co",
      "hotel_phone_number": "+1 828-555-0100",
      "distance_miles": 0.5,
      "available": true,
      "groups": [
        { "Signature Juliet": "For 4 adults and 0 children, with check-in on 2026-11-20 and check-out on 2026-11-22, the Signature Juliet (room_id: 123) has a base rate of $600.00 for 2 nights, taxes of $78.00, fees of $0.00, and a total of $678.00. The initial deposit to secure the reservation is $339.00." }
      ]
    },
    {
      "hotel_name": "The Blowing Rock Manor",
      "website": "https://blowingrockmanor.com",
      "available": false,
      "error": "Availability check timed out for this property."
    }
  ]
}
```

- `results` keeps the configured order. `groups` (the same room descriptions and prices as the sister hotel's own availability tool) is only present when `available` is true.
- `error` is `Availability check failed for this property.` or `Availability check timed out for this property.`
- `date_correction_details` is passed through when the sister hotel's PMS moved the dates (for example a check-in in the past).
- `message` is a one-line summary for the agent. It lists the available sister hotels, says which couldn't be checked, or, when every check worked and nothing is free, keeps the original wording: `Unfortunately, none of the nearby sister properties have availability for your dates either.`
- `400` for a bad request (missing `num_adults`, bad date format) or when the middleware can't find the calling hotel or the caller's active session.

KPIs: `cross_sell.availability.requested` (per call), `cross_sell.availability.found` (per sister hotel with rooms, `contextId` = sister hotel id), `cross_sell.availability.none_found` (per call), `cross_sell.availability.check_failed` (per sister hotel that failed or timed out).

## VAPI tool (FDE setup)

Add this `apiRequest` tool to the calling hotel's assistant. Use the DEV host for DEV agents (`https://daisy-voice-svc.dev.dextr.ai`) and the prod host (`https://daisy-voice-svc.dextr.ai`) only once the route is released to prod. `x-api-key` is the same Daisy inbound key the hotel's other tools use.

```json
{
  "type": "apiRequest",
  "name": "checkSisterHotelAvailability",
  "description": "Check availability and prices at this hotel's sister hotels for the guest's dates and party. Use it only when this hotel has no room that fits the guest (sold out, or the party is too big). It can't book at a sister hotel.",
  "method": "POST",
  "url": "https://daisy-voice-svc.dev.dextr.ai/daisy/sister-property-availability",
  "timeoutSeconds": 20,
  "headers": {
    "type": "object",
    "properties": {
      "x-api-key": { "type": "string", "value": "<Daisy inbound API key>" },
      "Content-Type": { "type": "string", "value": "application/json" }
    }
  },
  "body": {
    "type": "object",
    "required": [
      "start_date",
      "end_date",
      "num_adults",
      "num_children",
      "caller_phone_number",
      "assistant_phone_number",
      "session_type"
    ],
    "properties": {
      "start_date": { "type": "string", "description": "Check-in date, YYYY-MM-DD", "default": "" },
      "end_date": { "type": "string", "description": "Check-out date, YYYY-MM-DD", "default": "" },
      "num_adults": { "type": "number", "description": "Number of adults in the party", "default": "" },
      "num_children": { "type": "number", "description": "Number of children in the party (infants don't count if the hotel says so)", "default": "0" },
      "num_pets": { "type": "number", "description": "Number of pets", "default": "0" },
      "caller_phone_number": { "type": "string", "description": "The full phone number of the user", "default": "" },
      "assistant_phone_number": { "type": "string", "description": "Phone number of the AI assistant. Always {{phoneNumber.number}}", "default": "" },
      "session_type": { "type": "string", "description": "Always CALL", "default": "CALL" }
    }
  },
  "messages": [
    { "type": "request-start", "content": "Let me check our sister hotels for you.", "blocking": true }
  ]
}
```

Suggested prompt rule (adjust per client):

> If no room at this hotel fits the guest's dates and party, call `checkSisterHotelAvailability` with the same dates and party. If a sister hotel has a room, tell the guest its name, the room and the total price from the result, then give its website or phone number (or transfer the call if the hotel wants that). You can't book at a sister hotel on this call. If a sister hotel couldn't be checked, give its website instead. Never quote a sister hotel's price unless it came from this tool.

The agent should still use its own hotel's availability tool first. This tool doesn't check the calling hotel.

## Not supported yet: booking at a sister hotel

Booking a room at the sister hotel during the same call would need:
- **A session at the sister hotel.** Reservation tools resolve the hotel from `assistant_phone_number` and need an active session for the caller there. The booking would need a cross-hotel session (or a `target_hotel_id` on the reservation tools, restricted to the configured sisters) so the reservation, quote and conversation belong to the sister hotel.
- **A payment link from the sister hotel.** The review page, deposit rules, cancellation policy, payment provider and account (Stripe Connect account, Cloudbeds Payments, Shift4) are per hotel, so the link must be built for the sister hotel and not the calling one.
- **SMS from the right number.** The guest gets the link and confirmation by SMS. It's an open decision whether that comes from the calling hotel's number (the one the guest just spoke to) or the sister hotel's, and the text must name the sister hotel.
- **Reporting and escalations.** The booking, any later escalation and the dashboard view should belong to the sister hotel, with a note that it came from the calling hotel's agent.
