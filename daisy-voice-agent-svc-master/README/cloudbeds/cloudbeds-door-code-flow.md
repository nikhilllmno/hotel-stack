# Cloudbeds Door Code — Daisy Flow

On-demand door code resolution when a guest calls.
Routes via `hotel_configurations.door_lock_config.source_of_truth`.

This doc covers the `/alfred/door-code` route. The voice and text agent route, `POST /daisy/reservation/door-code`, is in [`cloudbeds-door-code.md`](cloudbeds-door-code.md).

## Flow: Guest Calls → Door Code Lookup

```
GET /alfred/door-code
(params: externalPartnerId OR lastName + checkoutDate)
        │
        ▼
  AlfredService.getDoorCodeByExternalPartner()
        │
        ▼
  Get hotel by assistantPhoneNumber
        │
        ▼
  Hotel found?
       ╱       ╲
     No         Yes
      │          │
      ▼          ▼
  fallback   Get hotelConfig
  to Alfred  .door_lock_config.source_of_truth
                │
                ▼
        source_of_truth === DoorLockSourceOfTruth.DAISY?
       ╱                          ╲
     No (alfred / absent)          Yes
      │                             │
      ▼                             ▼
  resolveDoorCodeViaAlfred()   resolveDoorCodeViaDaisy()
  (existing Alfred API call)          │
      │                               ▼
      │                     hotel.pms_provider === CLOUDBEDS?
      │                    ╱                          ╲
      │                  No                            Yes
      │                   │                             │
      │                   ▼                             ▼
      │             throw Error              enforceProspectorInnPaymentGuard()
      │             (unsupported PMS)                   │
      │                                                 ▼
      │                                      resolveCloudbedsReservationId()
      │                                     ╱                     ╲
      │                              externalPartnerId       lastName + checkoutDate
      │                              (use directly)          (search Cloudbeds API
      │                                     │                 → match by checkout)
      │                                     └────────┬────────┘
      │                                              ▼
      │                               CloudbedsReservationService
      │                               .resolveDoorCode(hotel, reservationId)
      │                                              │
      │                                              ▼
      │                               GET /doorlock/v1/keys/{propertyId}
      │                               ?reservationId=X
      │                                              │
      │                                              ▼
      │                               Found access_code with status=completed
      │                               and keyCode present?
      │                              ╱                          ╲
      │                            Yes                           No
      │                             │                             │
      │                             ▼                             ▼
      │                       return keyCode             door_lock_custom_field
      │                                                  configured in door_lock_config?
      │                                                 ╱               ╲
      │                                               No                 Yes
      │                                                │                  │
      │                                                ▼                  ▼
      │                                          return null       getReservation()
      │                                                            → scan customFields
      │                                                            for matching shortcode
      │                                                                   │
      │                                                                   ▼
      │                                                            return value or null
      │
      └──────────────────────────────────┐
                                         ▼
                                   Return door code
                                   to voice agent
```

## Configuration

### hotel_configurations.door_lock_config (JSONB)

```json
{
  "source_of_truth": "daisy",
  "door_lock_custom_field": "door_lock"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `source_of_truth` | `DoorLockSourceOfTruth` enum | `"daisy"` = resolve via Cloudbeds API; `"alfred"` or absent = use Alfred |
| `door_lock_custom_field` | `string` (optional) | Shortcode of the Cloudbeds custom field used as fallback |

### Reservation ID Resolution

Two modes depending on what the caller provides:

| Mode | Params | How reservation ID is resolved |
|------|--------|-------------------------------|
| Direct | `externalPartnerId` | Used as-is (it IS the Cloudbeds reservation ID) |
| Search | `lastName` + `checkoutDate` | Search Cloudbeds by last name → filter by checkout date → extract reservation ID |

## Key Files

| File | Purpose |
|------|---------|
| `src/services/alfred/alfredService.ts` | Routing logic, payment guard, reservation ID resolution |
| `src/cloudbeds/services/reservationService.ts` | `resolveDoorCode()` — Door Lock API + custom field fallback |
| `src/cloudbeds/client/CloudbedsClient.ts` | `getDoorLockKeys()` — HTTP call to Door Lock API |
| `src/cloudbeds/types/DoorLockResponse.ts` | TypeScript interfaces for Door Lock API |
| `src/types/hotelConfiguration.ts` | `DoorLockConfig`, `DoorLockSourceOfTruth` types |
| `src/models/HotelConfiguration.ts` | `door_lock_config` field |
| `src/migrations/152_add_door_lock_config.ts` | DB migration for the JSONB column |

## Cloudbeds Door Lock API

- **Endpoint**: `GET /doorlock/v1/keys/{propertyId}?reservationId=X`
- **Base URL**: Configured via `CLOUDBEDS_DOORLOCK_API_BASE_URL` env var
- **Auth**: Bearer token (per-hotel Cloudbeds access token)
- **Returns**: Array of keys with `keyId`, `keyType`, `keyCode`, `status`
- **Filter**: First key with `keyType=access_code`, `status=completed`, and `keyCode` present

## Custom Field Fallback

Legacy path — some properties (e.g. RemoteLock) store door codes in a
reservation custom field. The shortcode is set in `door_lock_config.door_lock_custom_field`.

- **Endpoint**: `GET /api/v1.3/getReservation?reservationID=X&propertyID=Y`
- **Field path**: `customFields[].shortcode` matching configured shortcode
