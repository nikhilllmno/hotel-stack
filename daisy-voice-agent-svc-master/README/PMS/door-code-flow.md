# PMS Door Code Resolution — Architecture & History

How Daisy resolves a room's **door / lock code** when a guest calls and asks
for it, why the `/alfred/door-code` endpoint exists, and the direction we are
taking it for every PMS after ResNexus.

> Cloudbeds-specific mechanics (Door Lock API, custom-field fallback, reservation
> ID resolution) live in [`../cloudbeds/cloudbeds-door-code-flow.md`](../cloudbeds/cloudbeds-door-code-flow.md).
> This doc is the cross-PMS story and the target design.

---

## 1. The entry point — `POST /alfred/door-code`

```ts
// websocket-server/src/router/alfredRouter.ts
alfredRouter.post(
  '/door-code',
  controller.getDoorCodeByExternalPartner.bind(controller),
);
```

The name is historical. Despite living under `/alfred/*` and being named
`getDoorCodeByExternalPartner`, this route is **no longer a pure pass-through to
Alfred** — it is the single door-code entry point for the voice agent, and it
routes internally by PMS and configuration (§4).

Lookup params (from the voice agent): either an **`externalPartnerId`** (the PMS
reservation id) *or* **`lastName` + `checkoutDate`**. The guest's hotel is
resolved from the assistant phone number on the request.

---

## 2. Why the endpoint exists — the ResNexus story

The door-code logic was **first implemented long ago inside Alfred, for
ResNexus** — and it lives there even for properties that don't otherwise need
Alfred. The reason is a ResNexus limitation:

- **ResNexus does not offer APIs or webhooks to query reservations.** There is no clean way
  to look up a reservation (and therefore its door code) on demand from ResNexus
  directly.
- **Alfred already has the data anyway.** Through a bespoke workaround, Alfred
  ingests reservation and customer data for ResNexus properties into its own
  store (the Alfred customers table). So inside Alfred, reservation → customer →
  door code is all readily accessible.

When the need arose to expose door codes through **Daisy** (i.e. a guest calls
the voice agent and asks for their code), the team faced a choice: replicate
ResNexus's complex ingestion workaround inside Daisy, or reuse what Alfred
already had. **They chose to invoke Alfred from Daisy** — hence a Daisy endpoint
(`/alfred/door-code`) that simply calls Alfred and returns
`external_partner_doorcode`. That is the `resolveDoorCodeViaAlfred` path today.

This was the right call **for ResNexus specifically**, because ResNexus gives us
no reservation API to work with.

---

## 3. Cloudbeds — static first (via Alfred), then dynamic (Daisy-native)

Cloudbeds evolved in two stages, and the split still exists today.

### 3.1 Static door codes — kept in Alfred

The first Cloudbeds properties had **static door codes** (a fixed code per
room/property, not one that changes per reservation). Because Alfred already
owned the door-code logic, we did the simplest thing:

- We received guest + reservation info in **Alfred via Cloudbeds webhooks**.
- We used that info to look up the **static door code from an Alfred env file**
  and stored it on the **Alfred customers table**.
- So when a guest asks Daisy for the code, Daisy **calls Alfred internally**
  (the `resolveDoorCodeViaAlfred` path), exactly like ResNexus.

Strictly, we *should* have built this in Daisy — but since Alfred already did it
this way, **Cloudbeds properties with static door codes keep resolving through
Alfred.** We are not migrating those.

### 3.2 Dynamic door codes — Daisy-native

When we needed to support **dynamic** door codes (per-reservation codes from
Cloudbeds' door-lock system), routing through Alfred no longer made sense.
Cloudbeds exposes reservation and door-lock APIs, so Daisy can resolve the code
itself. We added a config switch
(`hotel_configurations.door_lock_config.source_of_truth`) so a hotel can opt in
to **Daisy-native** resolution, and a Cloudbeds resolver that calls the Cloudbeds
Door Lock API (with a custom-field fallback). That work is
[`../cloudbeds/cloudbeds-door-code-flow.md`](../cloudbeds/cloudbeds-door-code-flow.md).

This dynamic, Daisy-native path is the pattern the rest of the PMS integrations
should follow — for both static and dynamic codes (§5).

---

## 4. Current routing logic

`AlfredService.getDoorCodeByExternalPartner`
(`websocket-server/src/services/alfred/alfredService.ts:273`):

```
POST /alfred/door-code
        │
        ▼
  Resolve hotel from assistant phone number
        │
        ▼
  hotelConfig.door_lock_config.source_of_truth === DAISY ?
       ╱                                        ╲
     Yes                                         No / absent
      │                                            │
      ▼                                            ▼
  resolveDoorCodeViaDaisy()                 resolveDoorCodeViaAlfred()
  routes by hotel.pms_provider:             (call Alfred, read
    - CLOUDBEDS → cloudbedsDoorCodeResolver  external_partner_doorcode)
    - else      → throw (unsupported)
```

| Path | When | What it does |
|------|------|--------------|
| `resolveDoorCodeViaDaisy` | `source_of_truth = daisy` | Daisy resolves the code itself, routed by `pms_provider` (Cloudbeds today) |
| `resolveDoorCodeViaAlfred` | `source_of_truth = alfred` or absent | Calls Alfred, returns `external_partner_doorcode` (the ResNexus path) |

Config (`DoorLockConfig`, `types/hotelConfiguration.ts:281`):

```json
{ "source_of_truth": "daisy", "door_lock_custom_field": "door_lock" }
```

`DoorLockSourceOfTruth` = `daisy` | `alfred`. Absent ⇒ Alfred.

---

## 5. Target design — Daisy resolves for every PMS except ResNexus

The principle going forward:

> **For every PMS except ResNexus, whoever receives the call fetches the door
> code directly — Daisy for Daisy calls, Alfred for Alfred calls. There is no
> reason to hop Daisy → Alfred.**

The rationale is data-locality, not convenience:

- Every PMS **except ResNexus** exposes APIs we can use to fetch door codes
  (or reservation data we can resolve a code from). ResNexus is the sole
  exception, and the only reason the Alfred hop exists.
- It **does not make logical sense to store customer / reservation / door-code
  data in Alfred if no properties on that PMS actually use Alfred.** Routing a
  Daisy call through Alfred would force us to keep that data in Alfred purely as
  a lookup cache — unnecessary duplication.

So the rule is:

| Call arrives via… | Who fetches the door code |
|-------------------|---------------------------|
| **Daisy** (guest calls the voice agent) | **Daisy** fetches it directly from the PMS / RemoteLock |
| **Alfred** (property uses Alfred) | **Alfred** fetches it directly — implement the same resolution there |
| ResNexus (any channel) | Alfred (only because ResNexus has no reservation API) |

**Static or dynamic makes no difference.** For any PMS other than ResNexus —
regardless of whether its door codes are static or dynamic — **Daisy and Alfred
each have their own implementation.** Daisy resolves codes for Daisy calls,
Alfred resolves them for Alfred calls; neither hops through the other.

> **The only carve-out is existing Cloudbeds static-code properties** (§3.1),
> which stay on the Alfred path because they were built that way. New work does
> not follow that precedent.

### 5.1 Stayntouch — the next one to do

For **Stayntouch**, we should invoke the **Stayntouch endpoint from inside the
`/door-code` route** (a Stayntouch branch in `resolveDoorCodeViaDaisy`) and
**not route to Alfred at all**. If a Stayntouch property also uses Alfred, we
implement the same direct-fetch logic **inside the Alfred repo** for the calls
that arrive there — again, no Daisy → Alfred hop.

---

## 6. Where the code comes from — PMS API first, then RemoteLock

When resolving a door code directly, prefer the PMS's own API; fall back to
**RemoteLock** only when the PMS can't give us the code:

1. **PMS API.** If the PMS offers a way to fetch the door code directly (e.g.
   Cloudbeds' Door Lock API), **use it.**
2. **RemoteLock.** We are also integrated with **RemoteLock**
   (`websocket-server/src/remotelock/`) for door codes. If a property has **no
   provision to get codes from the PMS API**, resolve them via the **RemoteLock
   APIs** instead.

(Some properties also stash a code in a PMS reservation **custom field** — e.g.
RemoteLock-managed properties on Cloudbeds — handled by
`door_lock_config.door_lock_custom_field`. See the Cloudbeds door-code doc.)

---

## 7. Key files

| File | Role |
|------|------|
| `websocket-server/src/router/alfredRouter.ts` | `POST /alfred/door-code` route |
| `websocket-server/src/services/alfred/alfredService.ts` | `getDoorCodeByExternalPartner`, `resolveDoorCodeViaDaisy`, `resolveDoorCodeViaAlfred`, Cloudbeds resolver |
| `websocket-server/src/cloudbeds/services/reservationService.ts` | `resolveDoorCode` — Cloudbeds Door Lock API + custom-field fallback |
| `websocket-server/src/remotelock/` | RemoteLock client / services / matching (fallback code source) |
| `websocket-server/src/types/hotelConfiguration.ts` | `DoorLockConfig`, `DoorLockSourceOfTruth` |
| `README/cloudbeds/cloudbeds-door-code-flow.md` | Cloudbeds-specific door-code mechanics |

---

## 8. TODOs

- **[ ] Stayntouch door codes via Daisy** (§5.1): add a Stayntouch branch to
  `resolveDoorCodeViaDaisy` that calls the Stayntouch endpoint directly; do not
  route to Alfred. Mirror the same logic in the Alfred repo for Alfred-served
  Stayntouch properties.
- **[ ] Generalize the Daisy-native path** so any PMS with reservation/door-lock
  APIs resolves through Daisy, leaving `resolveDoorCodeViaAlfred` for ResNexus
  only.
- **[ ] RemoteLock fallback wiring** for PMS providers whose API cannot return a
  door code directly.
