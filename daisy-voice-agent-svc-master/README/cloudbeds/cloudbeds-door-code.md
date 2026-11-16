# Cloudbeds door codes

`POST /daisy/reservation/door-code` returns a guest's door code. For a Cloudbeds hotel whose `door_lock_config.source_of_truth` is `daisy`, the code is read from Cloudbeds, RemoteLock is not involved, and a code is only given to a caller whose caller ID is on a stay covering today (section 3). Every other hotel, including Cloudbeds hotels without that setting, keeps the RemoteLock path in the main `README.md`.

The Alfred route (`/alfred/door-code`) uses the same Cloudbeds resolver with its own reservation lookup; see [`cloudbeds-door-code-flow.md`](cloudbeds-door-code-flow.md).

---

## 1. Configure a hotel

Set `hotel_configurations.door_lock_config` (jsonb):

```json
{ "source_of_truth": "daisy", "door_lock_custom_field": "<shortcode>" }
```

| Key | Value | Effect |
|---|---|---|
| `source_of_truth` | `"daisy"` | Turns this branch on. Any other value, or no `door_lock_config`, keeps RemoteLock. |
| `door_lock_custom_field` | the custom field's **shortcode**, not its display name | The reservation custom field read when the Door Lock API has no code. Leave it out if the hotel only uses the Door Lock API. |

- The hotel also needs `pms_provider = cloudbeds` and a live Cloudbeds token in `external_auth_config.apiToken`.
- The same keys drive `/alfred/door-code`, so setting `source_of_truth` to `daisy` switches that route to Cloudbeds as well.
- Point `door_lock_custom_field` at the field that holds the code, not at neighbouring fields such as a guest-portal link.

### Finding the custom field shortcode

The shortcode is the field's stable internal code. The label staff see (e.g. "Check In Code") is its name, and it is not what we match on.

- **From a reservation (most reliable).** Call `GET https://api.cloudbeds.com/api/v1.3/getReservation?propertyID=<propertyID>&reservationID=<reservationID>` for a booking that has the field filled in. In `data.customFields[]`, find the entry whose `customFieldName` is the field you want and copy its `shortcode`. This only needs `read:reservation`, which Daisy's token already has.
- **List every field.** `GET /api/v1.3/getCustomFields?propertyID=<propertyID>` returns each field's `name` and `shortcode`. It needs the `read:customFields` scope.
- **Cloudbeds UI.** Settings → Guests → Custom Fields. The shortcode is the field's "Internal Field Shortcode", set when the field is created. (Unconfirmed; use the API if you can't find it.)

Only reservation-level custom fields are read, not guest-level ones, and the field must be active (not archived).

## 2. Request

```json
{
  "booking_id": "4KX2B7Q9",
  "session_type": "CALL",
  "assistant_phone_number": "<hotel assistant number>",
  "caller_phone_number": "+15555550123"
}
```

- `booking_id` is optional. It can be the Cloudbeds reservation ID (a number is fine), an OTA confirmation number (matched through the `sourceReservationId` filter of Cloudbeds' `getReservations`), or Daisy's own `BK...` id. Without it (or blank or `null`), Daisy looks the caller's stay up by the caller ID.
- `guest_name` and `check_out_date` are ignored for these hotels: a name is not checked, the caller ID is.
- `session_type` and the hotel lookup work as for every other hotel on this route. A request without `session_type` is still a `400`.
- The caller ID is the session's caller number for a `CALL` or `SMS` session only. Web chat and other sessions have none, so they always get `caller_id_unavailable`.

## 3. Who gets a code

A door code opens a guest's room (and, at some hotels, the building), so it is only given to a caller verified on the stay:

1. **Caller ID.** The caller ID must be the `guestPhone` or `guestCellPhone` of a guest on the reservation (the main guest or any other guest). Numbers compare on their last 10 digits, as for the lockbox (`isSamePhone` in `src/lockbox/matching/callerMatch.ts`); a number with fewer than 7 digits matches nothing.
2. **Status.** The reservation must be `confirmed` or `checked_in`. Cancelled, no-show, not-confirmed and checked-out reservations are refused.
3. **Stay window.** Today, in the hotel's timezone, must be on or after the check-in date and on or before the check-out date. A guest arriving after midnight is covered, since their check-in date is still on or before today.

The caller check runs first, so a caller who isn't on the reservation learns nothing about its status or dates.

- **With `booking_id`:** that one reservation is read live from Cloudbeds and must pass all three checks.
- **Without `booking_id`:** Daisy lists the reservations staying today (Cloudbeds `getReservations` with `checkInFrom` = 30 nights ago, `checkInTo` and `checkOutFrom` = today, 100 a page, up to 10 pages), keeps those of this property that pass the three checks, reads each again by id, and checks the fresh copy. Each one that still passes gets its code. If the caller ID is on stays whose main guests have different full names, nothing is returned (`ambiguous_caller`): a number shared that way (an OTA relay or a placeholder number staff typed in) doesn't identify one guest. The agent can then ask for the booking ID. A stay that checked in more than 30 nights ago is only found by its booking ID.

Known limits:

- OTA bookings that carry a relay or masked number, and guests who call from a phone that isn't on the reservation, are refused (`caller_not_on_reservation` or `reservation_not_found`). The agent should transfer them to staff.
- Caller ID can be spoofed. These checks raise the bar from "knows a booking ID" to "calls from a number on the reservation" (plus the booking ID when one is given), but they don't replace staff judgement for disputed cases.
- No payment check is applied, the same as the RemoteLock branch.

## 4. Flow

1. `RoomReservationController.getDoorCode` loads the hotel. For `pms_provider = cloudbeds` it reads `door_lock_config`; `source_of_truth = daisy` validates the request with `callerIdLookup` (so `booking_id` is optional) and calls `CloudbedsDoorCodeService.getDoorCodes`.
2. Without a caller ID, the answer is `caller_id_unavailable` before Cloudbeds is asked.
3. The reservation(s) are read live from Cloudbeds (`getReservationByIdOrThrow`; without `booking_id`, `getStaysOnDateOrThrow` first). A `BK...` id is mapped to its Cloudbeds id through Daisy's `reservations.external_id`; Daisy's stored dates and status are never used, since they aren't synced on every Cloudbeds change.
4. Each reservation that passes section 3 gets its code from `CloudbedsReservationService.resolveDoorCode(hotel, reservationID, door_lock_custom_field)`: the Door Lock API (a `completed` `access_code` key), then the custom field.
5. `parseDoorCodeText` splits the value into `code` and `door_code_text`.

The whole lookup must finish within 10 seconds. Any Cloudbeds error (or a failure of Daisy's own `BK...` lookup) or the timeout refuses with `reservation_lookup_failed` and is logged. A failure while reading the code itself is logged by `resolveDoorCode` and answered as `no_door_code`.

## 5. Response

Always HTTP 200 once the request is well formed.

```json
{
  "success": true,
  "door_codes": [
    {
      "booking_id": "6098484913491",
      "room": "202",
      "code": "5732",
      "door_code_text": "The 1850 Hotel Room 202: 5732",
      "check_in": "2026-08-01",
      "check_out": "2026-08-05"
    }
  ]
}
```

- `booking_id`: the Cloudbeds reservation ID, whichever id was sent.
- `room`: the assigned room(s), as the reservation lookup reports `room_number` (the number at the end of the room's name, or the whole name), comma-separated for a multi-room reservation; `null` when no room is assigned.
- `code`: when the text ends in a colon and a 3–10 digit PIN, those digits. Otherwise it is the whole text, so nothing is guessed.
- `door_code_text`: the stored text, trimmed. It names the room or door, and it is the thing to read out when `code` is not just digits (for example, a field that lists two codes).
- `check_in` / `check_out`: the stay's dates (`YYYY-MM-DD`). A custom field has no validity window, so no time is implied.
- One entry per verified stay that has a code. Stays without one are left out. No guest name or phone number is ever returned.

Refusals:

```json
{ "success": false, "reason": "caller_not_on_reservation" }
```

| `reason` | When |
|---|---|
| `caller_id_unavailable` | The session has no caller ID (not a call or SMS, or a blank or too-short number) |
| `reservation_not_found` | With `booking_id`: Cloudbeds has no such reservation for this property (or a `BK...` booking never reached Cloudbeds). Without: no live stay covering today has a guest with the caller ID |
| `caller_not_on_reservation` | The booking's reservation has no guest whose phone or cell phone is the caller ID |
| `ambiguous_caller` | Without `booking_id`: the caller ID is on stays of different main guests |
| `reservation_not_active` | The booking's reservation is cancelled, a no-show, not confirmed or checked out |
| `not_in_stay_window` | Today is before the booking's check-in date or after its check-out date |
| `no_door_code` | The stay is verified, but Cloudbeds holds no code for it |
| `reservation_lookup_failed` | Cloudbeds or Daisy's booking lookup failed, or the lookup took more than 10 seconds |

The agent prompt should turn every refusal into an apology and a transfer to staff; for `reservation_not_found` or `ambiguous_caller` without a booking ID, it can first ask for the booking ID.

## 6. KPIs and logs

| Stat | Constant | Emitted when |
|---|---|---|
| `cloudbeds.door_code.resolved` | `KpiStat.CloudbedsDoorCodeResolved` | At least one code returned |
| `cloudbeds.door_code.not_found` | `KpiStat.CloudbedsDoorCodeNotFound` | `no_door_code` |
| `cloudbeds.door_code.refused` | `KpiStat.CloudbedsDoorCodeRefused` | Any other refusal except a lookup failure |
| `cloudbeds.door_code.lookup_failed` | `KpiStat.CloudbedsDoorCodeLookupFailed` | `reservation_lookup_failed` |

All use `contextName: 'CloudbedsDoorCodeService.getDoorCodes'` and `clientId` = the assistant phone number. Logs carry the hotel id, the lookup type (`booking_id` or `caller_id`), the booking id sent, the Cloudbeds reservation ids and the reason, never a guest name, phone number or code. `caller_not_on_reservation` and `ambiguous_caller` are logged as warnings.

## 7. Code map

| Piece | Location |
|---|---|
| Route | `src/router/roomReservationRouter.ts` (`/reservation/door-code`) |
| Controller branch | `RoomReservationController.getDoorCode` |
| Caller and stay checks | `src/cloudbeds/services/doorCodeService.ts` (`CloudbedsDoorCodeService`) |
| Phone matching, Cloudbeds status rule | `src/lockbox/matching/callerMatch.ts`, `src/lockbox/services/lockboxStayService.ts` (shared with the lockbox) |
| Stays on a date | `CloudbedsReservationService.getStaysOnDateOrThrow` |
| Resolver (shared with Alfred) | `CloudbedsReservationService.resolveDoorCode` |
| Text parsing | `src/cloudbeds/utils/parseDoorCodeText.ts` |
| Config type | `DoorLockConfig` in `src/types/hotelConfiguration.ts` |
| Tests | `doorCodeService.test.ts`, `roomReservationController.getDoorCode.test.ts`, `getArrivalsOrThrow.test.ts`, `validateGetDoorCodeRequestParams.test.ts`, `parseDoorCodeText.test.ts` |

## 8. Testing locally

1. From `websocket-server/`, run `npm run dev` (port from `PORT` in `.env`).
2. `POST http://localhost:<PORT>/daisy/reservation/door-code` with the body above, from a `CALL` session whose caller number is a guest's phone on a test reservation staying today.
3. The hotel needs `pms_provider = cloudbeds`, a Cloudbeds token in `external_auth_config`, and `door_lock_config` set as in section 1.
