# Lockbox codes from a hotel's Dropbox Excel log

Some hotels give late arrivals a lockbox code: after the front desk closes, the room key waits in a lockbox and the guest calls the agent for the box number and code. Staff keep the assignments in their own Excel workbook. `POST /daisy/lockbox-code` finds the caller's reservation in the hotel's PMS, by the caller's phone number (or the reservation the agent found and the caller's name on it), checks it, then reads the latest version of that workbook from Dropbox and returns only the box(es) of the rooms that caller may have.

The first hotel is The Marlo Hotel ("The Marlo Lockbox Log.xlsm"). Nothing in the code is Marlo-specific: any hotel that keeps a workbook with the layout below can use it.

Code: `src/lockbox/` (parsing, matching, reservation check, service) and `src/dropbox/` (API client).

## Request and response

`POST /daisy/lockbox-code` sits behind the same middleware as the other agent tools: `x-api-key`, the caller's number (`caller_phone_number` or `X-Phone-Number`), `assistant_phone_number` (or `business_id`) to find the hotel, `session_type`, and an active session.

There are two ways to ask. **By phone (no `booking_id`)**, the phone-first flow:

```json
{ "session_type": "CALL" }
{ "booking_phone": "+1 555 222 3333", "last_name": "Lovelace", "session_type": "CALL" }
```

1. First with no fields: Daisy looks for tonight's reservation by the caller ID. No name is needed (see Finding the reservation by phone).
2. Only if that answers `reservation_not_found`, the agent asks for the phone number on the booking and the caller's last name, and calls again with both.

- `booking_phone` (optional): the phone number the caller says is on the booking. Any format (`+1 (555) 222-3333`, `5552223333`); it may also be a number. Without it, the caller ID is used. When it is the caller ID itself, it counts as the caller ID and needs no last name.
- `last_name` (optional): the caller's last name, as they said it. Needed with a `booking_phone` that isn't the caller ID; without it the answer is `last_name_required`, before the PMS is asked.
- `room_number` (optional): as below.
- `customer_name` is not used without `booking_id`.

**By booking id**, as before (unchanged):

```json
{ "booking_id": "6098484913491", "customer_name": "Ada Lovelace", "session_type": "CALL" }
```

- `booking_id`: the reservation the agent found earlier in the call with its reservation lookup. Any id that lookup returns works: the PMS reservation id, an OTA confirmation number the PMS holds, or Daisy's own `BK…` id. It may also be a number. Blank or `null` counts as not sent, which makes the request a phone lookup.
- `customer_name` (required with `booking_id`): the caller's first and last name, as the caller said it, not copied from the lookup. It must be the name of a guest on the reservation, and it decides which of its rooms the caller may have (see Reservation check). A last name alone never matches.
- `room_number` (optional, both ways): one of the reservation's rooms, to answer for that room only. It is checked against the reservation and never finds a box on its own. Blank or `null` counts as not sent. It may also be a number. For a room listed in the hotel's `room_number_overrides` (see Hotel configuration), its Cloudbeds name and the number set for it both work.
- A `booking_id` without a `customer_name` (missing or blank), a missing `session_type`, a field of the wrong type, or one over its length limit (`booking_id` 64, `customer_name` 200, `room_number` 20, `booking_phone` 40, `last_name` 100 characters) is a `400`.

Every lookup outcome is a `200`, so the agent can always act on it:

```json
{
  "success": true,
  "lockbox_number": "4",
  "code": "*4821",
  "note": "Balance of $40 will be collected at check-out",
  "lockboxes": [
    {
      "lockbox_number": "4",
      "room_number": "8",
      "code": "*4821",
      "note": "Balance of $40 will be collected at check-out"
    }
  ]
}
```

`lockboxes` lists every matching box for the rooms the caller may have (a guest can hold more than one, and a booking can have several rooms), room by room in the reservation's room order, and, for a phone lookup that finds several reservations, reservation by reservation. The top-level `lockbox_number`, `code` and `note` repeat the first one for simple prompts. When `room_number` is sent, only that room's boxes come back. All values are strings, so codes keep their exact text. `room_number` is the room written on the box, or the reservation's room for a box matched by the blank-room fallback (see Matching rule). `note` is the box's NOTES cell, trimmed, and is left out when NOTES is blank. Staff should write NOTES for the guest to hear (the agent may read it out), e.g. that the team will collect a remaining balance. GUEST NAME and other guests' rows (and their NOTES) are never returned.

```json
{ "success": false, "reason": "not_found" }
```

In the order they're checked (`reservation_lookup_failed` can also come last, from the same-name check in Matching rule):

| `reason` | Meaning |
|---|---|
| `not_configured` | The hotel has no `door_lock_config.lockbox_log`. |
| `reservation_lookup_unsupported` | The hotel's PMS can't load reservations, so no request can be checked. Only Cloudbeds can so far. |
| `last_name_required` | By phone only: a `booking_phone` that isn't the caller ID came without a `last_name`. Ask for it and call again. |
| `reservation_lookup_failed` | A PMS lookup failed or timed out, or an OTA id is carried by more than one live reservation. |
| `reservation_not_found` | By booking id: the hotel's PMS has no reservation with this id, or it belongs to another property. By phone: no live arrival tonight has a guest with the number, or, for a `booking_phone`, none has one with the caller's last name too (both answer the same, so a phone number alone reveals nothing). |
| `reservation_not_active` | The reservation is cancelled, a no-show, checked out or not confirmed. |
| `not_arriving_tonight` | The reservation doesn't check in on the date of the lockbox assignment in force (see Date rule), e.g. a stay starting tomorrow or next week, or last night's arrival calling after noon. Also checked against the assignment actually read from the log. |
| `no_room_assigned` | The reservation has no room assigned for its check-in date. |
| `reservation_mismatch` | `customer_name` isn't the name of a guest on the reservation (or of one in the `room_number` sent), or `room_number` isn't one of its rooms. |
| `balance_due` | The reservation still owes a balance (Cloudbeds `balance` above 0), or Cloudbeds gave no balance that can be read, and the hotel's `lockbox_balance_policy` is `refuse` (the default). The hotel collects it before a self check-in. |
| `log_unavailable` | The workbook couldn't be downloaded (Dropbox error, missing `DROPBOX_*` env) or read (not a workbook, or the layout changed). |
| `no_assignment_today` | Neither the Today tab nor the Archive covers today: staff haven't updated the log. |
| `not_found` | The log has assignments for the date, but no box matches the caller's rooms and the names the PMS lists in them, or the only match is a blank-room box whose name another arrival that night also has. |

A phone lookup can find several reservations (one booker, several rooms or friends). Each is checked on its own, and the boxes of every one that passes come back together. If none passes the reservation check, the answer is the refusal of the one that got furthest through the checks below (e.g. `balance_due` over `no_room_assigned`).

## Finding the reservation by phone

Without `booking_id`, Daisy finds the caller's reservation(s) itself, so the caller can't choose a reservation or a room:

1. **Which number.** `booking_phone` when sent, else the caller ID. The caller ID is the session's caller number on a `CALL` session (the real caller ID VAPI reports) or an `SMS` session (the sender); any other session (web chat sends an id there) has none, so it must send `booking_phone` and `last_name`.
2. **Tonight's arrivals.** Cloudbeds `getReservations` for the check-in dates the lockbox log uses (today in the hotel's timezone, and before noon also yesterday; see Date rule), with guest details, 100 a page until the last page (at most 10 pages; a warning is logged if more remain). `CloudbedsReservationService.getArrivalsOrThrow`.
3. **Live ones only.** Cancelled, no-show, unconfirmed and checked-out reservations are skipped, by the same status rule as the reservation check.
4. **The phone.** A reservation matches when any of its guests (the main guest or any other) has the number as `guestPhone` or `guestCellPhone`. Numbers compare on their digits only, by the last 10 (so `+1`, a trunk `0`, spaces and dashes don't matter). A number with fewer than 7 digits matches nothing, so a blank never matches.
5. **Read again.** Each match is read again with `getReservation` (`getReservationByIdOrThrow`), for its dated room assignments and balance, exactly as a booking id is read. A match whose fresh copy no longer has the number is dropped.
6. **Who the caller is.**
   - By caller ID: the guests with that number. No name is needed.
   - By `booking_phone`: the reservation counts only if one of its guests (the main guest, or another guest Cloudbeds puts in one of its rooms) has a last name like `last_name`; the caller is that guest. A wrong last name answers `reservation_not_found`, exactly like an unknown number.
   - Last names compare as lowercase letters only (accents dropped; spaces, hyphens and apostrophes ignored), equal or a few typos apart (Levenshtein): none when the shorter name has 3 letters or fewer, 1 up to 5 letters, 2 beyond. Each part of 4 letters or more of a several-part name also counts on its own, on either side (`Garcia` matches `García López`).
7. **The usual checks.** Each reservation then goes through the reservation check below, with the identified guest in place of `customer_name`: the main guest may have every room's boxes, another guest only those of the rooms Cloudbeds puts them in. Then the log is read and matched exactly as for a booking id.

Steps 2 to 5 share one 8-second limit. Any Cloudbeds error or timeout answers `reservation_lookup_failed` (fails closed).

## Reservation check

Before the workbook is downloaded, Daisy reads the reservation behind `booking_id` live from the hotel's PMS and checks that nothing is owed on it. Daisy's stored copy isn't trusted for this: its dates and status aren't synced on every PMS change (Cloudbeds date changes, no-shows and check-outs aren't), and the agent's reservation lookup falls back to it when the PMS fails. The stored copy only maps Daisy's own `BK…` ids to the PMS reservation id (`external_id`).

- **Cloudbeds hotels only, so far.** `getReservation` by reservation id, with the source (OTA) id search as a fallback, bounded together at 8 seconds (`CloudbedsReservationService.getReservationByIdOrThrow`). A reservation for another Cloudbeds property counts as not found.
  - A source match must carry exactly that id as its `thirdPartyIdentifier` (ignoring case and spaces) and be for this property. A live reservation is chosen over a cancelled copy, and an id that two live reservations carry is refused rather than guessed. The match is then read again with `getReservation`, since list rows have no dated room assignments.
  - "Not found" needs Cloudbeds to answer both lookups: an unknown-id answer to `getReservation` (`success: false` on HTTP 200, or a 400 or 404) and no matching source row. Anything else, such as an auth error, a rate limit (429), a server error or a timeout, is `reservation_lookup_failed`.
- The reservation is read the way the agent's reservation lookup reports it: Daisy's status normalization, the main guest's first and last name, and each room's number from its Cloudbeds room name (the number at the end of the name, or the whole name when it doesn't end in one), as in the lookup's `room_number`. A room named in the hotel's `door_lock_config.room_number_overrides` takes the number set there instead (see Hotel configuration). Rooms come only from Cloudbeds' `assigned` list. Other guests come from its `guestList`, each with the reservation's rooms Cloudbeds puts them in (`roomName` and `rooms`).
- A code is only given when the stay:
  1. is `ACTIVE` and not checked out. Daisy reports a Cloudbeds `checked_out` stay as `ACTIVE`, so that status is checked separately;
  2. checks in today in the hotel's timezone, or yesterday before noon: the date rule the log uses, from one shared implementation (`lockboxAssignmentDates`). Once the log is read, the check-in must also be the date of the assignment actually in force, so before noon a Today tab still on yesterday serves only yesterday's arrivals;
  3. has a room assigned for its check-in date. A room the booking only holds from a later night doesn't count;
  4. has the caller as one of its guests: by booking id, `customer_name` must be a guest's name, under the log's name rule below, so a last name alone never matches; by phone, see Finding the reservation by phone. The main guest may have every room's boxes; another guest only those of the rooms Cloudbeds puts them in;
  5. has the `room_number` sent, if any, among those rooms (`8`, `08` and `Room 8` are room 8). The answer is then for that room only;
  6. owes nothing, under the hotel's default `lockbox_balance_policy` (`refuse`; see Hotel configuration). From the GM's lockbox procedure: no self check-in while a balance or incidentals still need to be collected. The amount is the `balance` ("balance currently owed") on the same `getReservation` response, so it costs no extra call. A balance of 0 or less passes (a credit counts as paid), with a 0.005 tolerance for float noise. A numeric string such as `"0.00"` is read as a number; a missing, blank or non-numeric balance counts as owed and is logged as a warning. It's checked after the name, so a caller who isn't on the reservation gets `reservation_mismatch` and never learns whether it's paid. Under `allow_with_note` this check is skipped: the code is given and the box's NOTES go with it.
- Boxes are then matched on the rooms the caller may have and the names Cloudbeds lists in them, never on what the agent sent.
- It fails closed: a PMS error or timeout, or a PMS that can't load reservations, refuses the request and never skips the check.

## Hotel configuration

Stored in `hotel_configurations.door_lock_config` (jsonb, no migration needed), next to the existing door-code settings:

```http
PUT /api/hotel/:id/configuration
```

```json
{
  "door_lock_config": {
    "lockbox_log": {
      "provider": "dropbox_excel",
      "shared_link": "https://www.dropbox.com/scl/fi/<id>/<file>.xlsm?rlkey=<key>&dl=0"
    }
  }
}
```

- The hotel must be on Cloudbeds; for any other PMS every request is refused with `reservation_lookup_unsupported` (see Reservation check).
- `provider` must be `dropbox_excel`. `shared_link` must be an `https://` Dropbox link. Paste it exactly as Dropbox gives it; `get_shared_link_file` accepts it as-is.
- An update merges into the stored `door_lock_config`, so adding `lockbox_log` keeps `source_of_truth` and `door_lock_custom_field`. Send `"lockbox_log": null` to remove only the log, or `"door_lock_config": null` to clear everything.
- Treat the link as sensitive. It identifies the workbook that holds every code, and a link shared as "anyone with the link" downloads it on its own. Daisy's logs show only an 8-character fingerprint of it.

### Room number overrides

Boxes are matched on the room number staff write in ROOM / ROOM 2, read from the Cloudbeds room name (see Reservation check). A room whose Cloudbeds name doesn't end in that number never matches its box: at The Marlo, Cloudbeds calls the accessible room "Freya Accessible King Retreat" while staff file it as room 19, so a Freya guest got `not_found`. `room_number_overrides` maps such a room's Cloudbeds name to the room number used in the log:

```json
{
  "door_lock_config": {
    "room_number_overrides": {
      "Freya Accessible King Retreat": "19"
    }
  }
}
```

- Keys are Cloudbeds room names (`roomName`, as in the reservation's `assigned` list), matched exactly after trimming, ignoring case. A partial name, or one with different inner spacing, doesn't match. Values are the room as the log writes it, compared the same way as any room (`19` and `019` are the same room).
- An override is applied before the number at the end of the name is read, so it also works for a name that ends in a different number (`"Suite 2": "202"`). Rooms not listed are read exactly as before.
- It applies to the stay's rooms, to the rooms of the other guests on it, and to a `room_number` the agent sends. It only changes which number a room of the checked reservation goes by: the name and every other check still apply, so it fails closed as before.
- Limits: at most 200 rooms, names up to 100 characters, room numbers up to 20 characters, no blank names or numbers, and no name listed twice (ignoring case and surrounding spaces). If the stored map is malformed anyway (written outside the API), a bad entry is ignored and that room is read from its name, as without the override.
- `door_lock_config` is merged one key deep, so sending `room_number_overrides` keeps `lockbox_log` but replaces the whole map: send every override each time. `"room_number_overrides": null` (or `{}`) removes them.
- Only `POST /daisy/lockbox-code` reads it. The agent's reservation lookup still reports `room_number` from the name alone (`null` for "Freya Accessible King Retreat").

### Balance policy

`lockbox_balance_policy` decides what happens when the reservation still owes a balance (or Cloudbeds gave none that can be read):

```json
{
  "door_lock_config": {
    "lockbox_balance_policy": "allow_with_note"
  }
}
```

- `refuse` (the default, also when missing, `null`, or any other stored value): no code, `balance_due`.
- `allow_with_note`: the code anyway, for hotels whose staff collect the balance by hand. Write a note for the guest in the box's NOTES (e.g. "We'll collect the remaining balance at check-out"); it comes back as `note`. The service logs each code given while a balance is owed, with the amount.
- Every other check still applies (the caller must be on the reservation, and so on). Merged one key deep like the other keys, so sending it keeps `lockbox_log` and `room_number_overrides`.

To onboard a hotel:

1. The hotel shares the workbook from their Dropbox with Dextr's Dropbox account (devops@dextr.ai). View access is enough.
2. Copy the shared link and set `door_lock_config.lockbox_log` as above.
3. Point the agent's lockbox tool at `POST /daisy/lockbox-code` with the standard tool fields (above), plus optional `booking_phone`, `last_name` and `room_number` for the phone-first flow: call it first with none of them (caller ID); on `reservation_not_found`, ask for the phone number on the booking and the caller's last name and call again with both; on `last_name_required`, ask for the last name; treat every other `success: false` as "apologize and offer the manager". On success, read the lockbox number(s) and code(s), and any `note`. The booking-id flow (`booking_id` + `customer_name`) still works for prompts that use it.

## Workbook layout

Read with `exceljs`, which loads `.xlsx` and macro-enabled `.xlsm` alike (macros are ignored). Formula cells are read from the values Excel cached when the file was last saved. Hidden tabs ("Daily Log", "Lists") are not used.

**Today** tab:

- `B4`: the date the assignments are for (a real date, or a formula such as `=TODAY()`).
- Row 6: headers `LOCKBOX`, `GUEST NAME`, `ROOM`, `ROOM 2`, `CODE`, and optionally `NOTES` (returned as the box's `note`; blank without the column).
- Each row below with a whole number in LOCKBOX is one box. Other rows (blank, notes, totals) are skipped.
- GUEST NAME says `OPEN` until staff type a name over it. CODE can be blank.

**Archive** tab (filled by the hotel's "archive" macro before staff change the Today date):

- Row 4: headers `DATE`, `LOCKBOX`, `GUEST NAME`, `ROOM`, `ROOM 2`, `CODE`, `NOTES`, `ORIGINAL NAME TEXT` (`NOTES` and `ORIGINAL NAME TEXT` are optional).
- Each row below with a date and a lockbox number is one archived box. Dates may be real dates, Excel serial numbers, or text (`M/D/YYYY` or `YYYY-MM-DD`).
- When a date was archived twice, each box keeps its most recent copy. Which end of the sheet is newest is read from the dates.

Columns are found by header text, ignoring case and extra spaces (Marlo's sheet has `"ROOM "` with a trailing space), so their order doesn't matter. The header rows themselves are fixed. A missing tab or header makes the lookup fail with `log_unavailable` rather than guess; the error names the tab and header, never a cell's contents.

CODE is always read as text. A code typed as a number has already lost any leading zeros in Excel, unless the cell's number format pads them (e.g. `00000`), in which case the padding is applied the way Excel displays it. Hotels should format the CODE column as text.

## Date rule

All in the hotel's timezone (`hotels.timezone`):

1. The Today tab, when `B4` is today.
2. The Today tab, when `B4` is yesterday and it's before noon: a guest arriving after midnight uses the previous evening's assignment.
3. Otherwise, the Archive rows dated today.
4. Otherwise, `no_assignment_today`.

The reservation's check-in must be the date of the assignment this picks (see Reservation check).

## Matching rule

Boxes are matched on the rooms from the Reservation check that the caller may have, and on the names Cloudbeds lists in each: the main guest's, and those of the other guests it puts in that room.

**Room rule.** Among the boxes whose **ROOM or ROOM 2 equals one of those rooms**, room by room:

1. **Named boxes first:** the boxes where one of that room's names matches GUEST NAME, or ORIGINAL NAME TEXT (Archive), as below.
   - **Only when no box has the exact name**, a box whose name is a few typos off: the same allowance as a caller's spoken name (the last name, and the first name or its first word, each a few letters off; `isSameGuestInRoom`). Staff type names by hand: on Nov 1 a Marlo guest's box read her first name with one letter missing, and she was transferred instead of getting her code. Because a typo can't prove the box is this guest's, it's used only when it is **the only** typo-matched box for the room and **every room it lists is on the guest's reservation** (so it never hands over another room's key). Two typo matches for one room, a typo match that also lists another room, or a one-word box name ("Alice" for "Alice E") give nothing, and the guest is transferred. Names within the allowance ("Steven" for "Stephen") do match.
2. **Else the room's one `OPEN` box.** Staff stage a key in an `OPEN` box under its room for a booking made after hours, when nobody can type the name (Christopher, The Marlo, Oct 30). It is used only when no other box lists the room: not a named box (any name), not a `NO KEY` or blank-name row, and not a second `OPEN` box. Two `OPEN` boxes for one room are never guessed between.

So a room on a named box **and** on an `OPEN` box is the named box's. On Oct 30 an `OPEN` row at The Marlo kept room 2 from earlier while the guest's named box (lockbox 1) also had room 2, and both codes were read out; now only lockbox 1 is. The service log records which rule matched (`matchedBy: room | open_room | name_only`).

Names are normalized the same way everywhere: case-insensitive, spaces trimmed and collapsed, and `Last, First` read as `First Last`. Under the room rule, two names match when they're equal, or when both have two or more words and agree on the first and the last word (so a middle name on either side is fine). A one-word name only matches itself. The only looser match is the room rule's typo step above, with its limits; the blank-room fallback below has none.

**Blank-room fallback.** Staff also leave ROOM and ROOM 2 blank on many named rows (about 40% of named Archive rows at Marlo). So, **only when the room rule finds no box for any of the rooms, and only for a reservation with a single room**, a box whose ROOM and ROOM 2 are **both** blank matches on an **exact full-name match** of the main guest: after normalization, their name must equal GUEST NAME or ORIGINAL NAME TEXT exactly, and have at least a first and a last word.

Such a box is tied to the reservation by the name alone, so before it is returned Daisy searches Cloudbeds for the reservations checking in that day under the main guest's last name (`CloudbedsReservationService.getArrivalsByLastNameOrThrow`). If any other one that isn't cancelled has a main guest with exactly the same full name, the box isn't returned (`not_found`): two guests with the same name arriving the same night, or a booking made under someone else's name, can't take each other's box. If Cloudbeds can't be asked, the answer is `reservation_lookup_failed`. The fallback never matches:

- an `OPEN` box, even when its ORIGINAL NAME TEXT is the guest's name;
- a single-word name, on either side;
- a partial name, such as a middle name on one side only (`Mary Evans` vs `MARY ANN EVANS`);
- a box filed under a different room.

Every box that matches the fallback is returned, and each one's `room_number` is the reservation's room, since the log has none. 

Room numbers compare as numbers when both are digits (`08` is room 8). A box without a code is never returned. Matching boxes are returned room by room, in the reservation's room order and each room's in log order, and each box once.

The room always comes from the checked reservation and never from the request.

## Dropbox app

Daisy reads the workbook as Dextr's own Dropbox account, through one Dextr app. Hotels never hold any Dextr credential.

1. Create the app at https://www.dropbox.com/developers/apps while signed in as devops@dextr.ai: **Scoped access**, **Full Dropbox** (hotels' files are outside any app folder).
2. Permissions: `files.metadata.read`, `files.content.read`, `sharing.read` (`account_info.read` is always on). Nothing that writes. The app can stay in Development status, since only Dextr's own account is linked to it.
3. Get a refresh token with the offline code flow. Open this URL signed in as devops@ and approve:

   ```
   https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&response_type=code&token_access_type=offline
   ```

   Then exchange the code within a few minutes:

   ```bash
   curl https://api.dropboxapi.com/oauth2/token \
     -d code=<CODE> -d grant_type=authorization_code \
     -u <APP_KEY>:<APP_SECRET>
   ```

   The response's `refresh_token` doesn't expire unless the app is unlinked or the token is revoked.
4. Set `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `DROPBOX_REFRESH_TOKEN` in the service's env file (S3 env for DEV and PROD). Never put them in code, docs or chat.

At runtime (`DropboxClient`):

- `POST https://api.dropboxapi.com/oauth2/token` with `grant_type=refresh_token` and HTTP Basic auth (app key and secret). The access token (4 hours) is cached in memory and replaced 5 minutes before it expires. If Dropbox rejects it early, it's dropped and the next call gets a new one.
- `POST https://content.dropboxapi.com/2/sharing/get_shared_link_file` with header `Dropbox-API-Arg: {"url": "<shared_link>"}` returns the file's current bytes.
- Each request sends a `User-Agent` and times out after 10 seconds. A file is cached per link for 60 seconds, so a burst of calls costs one download and a saved edit shows up within a minute. Concurrent calls share one token exchange and one download. Failures are not cached.

## Logs and KPIs

The lockbox service's own log lines carry the hotel id, booking id or reservation ids, how the caller was identified (`identifiedBy: caller_id | booking_phone`), dates, counts, the balance owed and the link fingerprint, never a guest name, phone number or code. Other lines from the same request do carry guest data: the request logger records the request body (with `booking_phone` and `last_name`), and the shared Cloudbeds HTTP client logs every call's query parameters (including the last name the same-name check searches) and the first 1,024 characters of each response body (guest names, emails and phone numbers), as it does for the agent's own reservation lookups. KPIs (`clientId` = the hotel's assistant phone number, `contextName` = `LockboxCodeService.getLockboxCode`):

| Stat | When |
|---|---|
| `lockbox.code.resolved` | At least one box returned |
| `lockbox.code.not_found` | `not_found`, including a blank-room box another arrival's name also fits |
| `lockbox.log.no_assignment` | `no_assignment_today` (the log is stale) |
| `lockbox.log.fetch_failed` | Download failed (`log_unavailable`) |
| `lockbox.log.parse_failed` | Workbook unreadable or layout changed (`log_unavailable`) |
| `lockbox.reservation.not_verified` | `reservation_not_found`, `reservation_not_active`, `not_arriving_tonight`, `no_room_assigned` |
| `lockbox.reservation.mismatch` | `reservation_mismatch`; also logged as a warning naming the fields that disagreed |
| `lockbox.reservation.balance_due` | `balance_due`; logged with the amount owed, or as a warning when Cloudbeds gave no readable balance |
| `lockbox.reservation.lookup_failed` | `reservation_lookup_failed` (the reservation, the phone lookup or the same-name check), `reservation_lookup_unsupported` |
| `lockbox.phone_lookup.caller_id_matched` | By phone: tonight's reservation(s) found by the caller ID (then one of the outcomes above) |
| `lockbox.phone_lookup.booking_phone_matched` | By phone: found by `booking_phone` and `last_name` (then one of the outcomes above) |
| `lockbox.phone_lookup.not_found` | By phone: nothing found (also counted as `lockbox.reservation.not_verified`) |

`last_name_required` is logged but not counted.

Like the RemoteLock door-code route, the response body (with the code) still appears in the request logger's `Outgoing Response` line.

## Known gaps

- A named box with ROOM and ROOM 2 blank only matches on the exact full name (no typo allowance without a room). A guest whose name staff typed differently there (a nickname, a missing middle name, a typo) gets `not_found` and is transferred.
- A code that lost its leading zeros in Excel is returned as stored.
- If staff move the Today tab to the next date before midnight, a guest arriving after midnight is refused (`not_arriving_tonight`): their own assignment is then only in the Archive under the previous date, which rule 3 doesn't read.
- By booking id, Daisy checks the reservation and the name on it, not the caller. A caller who knows a guest's first and last name and the booking (a relative, say) still gets the code. A caller who gives only a last name is refused only if the prompt sends the name as the caller said it, not the one the lookup returned.
- By phone, the caller ID is trusted as the caller's own number. A spoofed caller ID, or anyone on a phone the guest put on the booking (a family line, an assistant's phone), gets the code with no name. A spoken `booking_phone` needs a guest's last name too, which someone who knows the guest can also give. Capping refused attempts per call is an open product decision.
- By phone, a guest whose number isn't on the reservation (often a companion, or an OTA booking with the OTA's relay number) gets `reservation_not_found` and is offered the manager. The booking-id flow still works for them.
- Numbers match on their last 10 digits, so two numbers that differ only in the country code count as the same.
- Only the main guest and the guests Cloudbeds puts in a room get codes. A companion the hotel never added to the reservation is refused (`reservation_mismatch`), and a box filed under such a name (not `OPEN`) gives `not_found`.
- The blank-room fallback needs a single-room reservation and no other arrival that night with the main guest's exact name; otherwise the guest gets `not_found` and is transferred.
- A Daisy multi-room booking is several PMS reservations (`BK…_1`, `BK…_2`); each is looked up by its own `booking_id`, and the parent `BK…` id gives `reservation_not_found`. A phone lookup finds all of them.
- A phone lookup reads at most 1,000 arrivals (10 pages); a caller on a later page gets `reservation_not_found`.
- Cloudbeds hotels only; any other PMS gets `reservation_lookup_unsupported`.
- A room whose Cloudbeds name doesn't end in the number staff use in the log needs a `room_number_overrides` entry, or its guests get `not_found`. The agent's reservation lookup doesn't apply the overrides: for an overridden name that ends in a different number (`"Suite 2": "202"`), a `room_number` copied from the lookup (`2`) gets `reservation_mismatch`. The prompt can leave `room_number` out, or send the room name.
- Only the amount owed on the reservation (`balance`) is checked. An incidentals deposit or card hold the hotel still wants doesn't show there, so staff must collect it before they put a key in a box. A guest who pays at check-in (balance still owed) is refused with `balance_due` and transferred, unless the hotel's `lockbox_balance_policy` is `allow_with_note`.
