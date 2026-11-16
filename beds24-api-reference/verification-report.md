# Live API verification for Lotus Demo Hotel

**Passed: 70 of 70 checks** for property **366736**, using a property-restricted read-only credential. The verification recorded **14 authenticated GET requests**, all successful, on **8 November 2026 at 13:29 IST**. Detailed results are in [verification-report.json](verification-report.json).

The checks covered hotel identity, INR currency, check-in/out times, automatic confirmation, all three room types and their capacities, all 20 physical-unit mappings, clean housekeeping states, enabled fixed prices, and every weekday's price coverage. The five saved reservations reconcile to **10 room nights** and **₹47,000** in booking charges, with no payments recorded. The current and completed stays have the expected CHECKIN and CHECKOUT markers.

Inventory validation includes **69 room-type/day comparisons** and **460 physical-unit/day comparisons** across **8–30 November**. Available quantities agree with the reservations, and no unit overlaps were found. These grouped comparisons are included within the 70 checks.

## Verified stay quotes

| Room type | Stay | Guests | Total | Units available |
|---|---|---|---:|---:|
| Standard Double | 15–17 Nov 2026 | 2 adults | ₹6,000 | 9 |
| Deluxe Double | 20–22 Nov 2026 | 2 adults | ₹9,000 | 6 |
| Family Suite | 23–26 Nov 2026 | 2 adults, 2 children | ₹19,500 | 3 |
| Family Suite | 30 Nov–1 Dec 2026 | 4 adults | ₹6,500 | 3 |

A 23-night stay from **8 November to 1 December** priced correctly for every room type: Standard Double **₹69,000**, Deluxe Double **₹103,500**, and Family Suite **₹149,500**. A Standard Double request for three adults correctly returned no offer.

## Behavior to use in an integration

Full property responses require **`includeAllRooms=true`** in addition to `includeUnitDetails=true`; without it, this account returned partial room objects. The guide and Postman property request now include that flag.

The booking UI reference maps to the API **`reference`** field. All five booking IDs are recorded, including **DEMO-001 → 95853447**. API unit IDs are local to each room type and are mapped in [hotel-config.json](hotel-config.json).

## Verification limits

Requests for inventory dates **1–30 November** returned **8–30 November**. Past inventory for **1–7 November** was not returned. Historical reservations and fixed-price coverage from **1 November** were verified separately; missing historical calendar data was not treated as empty occupancy or as a failed rate setup.

Booking create/update/cancel/delete operations, issued invoice numbers, payment processing, external messages, OTA synchronization, webhook delivery, and execution through an MCP client were **not tested**. The credential has read permissions only. Charges were checked through booking invoice items.

The account remains on its **14-day trial**. Pricing covers the full month, but continued PMS service beyond the trial requires paid continuation. The verification establishes the tested read paths and demo data; it does not certify live channel distribution or payment operations.

No credential values are included in this report or package.
