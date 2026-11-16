# Saved demo hotel configuration

Hotel **366736** now contains **20 units** and pricing covering all of November and December 2026. These values were saved and observed in the Beds24 UI during this setup session on **8 November 2026**. The machine-readable snapshot is [hotel-config.json](hotel-config.json).

## Rooms and prices

| Room type | Room type ID | Quantity | Physical unit names | Nightly price | Fixed price ID |
|---|---:|---:|---|---:|---:|
| Standard Double | 754948 | 10 | 101–110 | ₹3,000 | 7046325 |
| Deluxe Double | 754949 | 6 | 201–206 | ₹4,500 | 7046326 |
| Family Suite | 754950 | 4 | 301–304 | ₹6,500 | 7046327 |

Each fixed price starts on **1 November 2026** and ends on **31 December 2026**. All **20 units are marked clean**. Currency is **INR**, timezone **Asia/Kolkata**, check-in **14:00–22:00**, and checkout **11:00**.

API unit mappings are now verified: Standard Double IDs **1–10** map to names **101–110**, Deluxe Double IDs **1–6** map to **201–206**, and Family Suite IDs **1–4** map to **301–304**. Unit IDs are scoped to their room type. Retrieve them with `GET /properties?id=366736&includeAllRooms=true&includeUnitDetails=true`. Room capacities are **2, 2, and 4 guests** respectively. The UI booking reference is returned in the API `reference` field.

## Saved synthetic reservations

| Reference | Booking ID | Unit | Arrival | Departure | Booking total | Recorded info code |
|---|---:|---|---|---|---:|---|
| DEMO-001 | 95853447 | Standard Double 101 | 15 Nov 2026 | 17 Nov 2026 | ₹6,000 | — |
| DEMO-002 | 95853671 | Standard Double 102 | 1 Nov 2026 | 3 Nov 2026 | ₹6,000 | CHECKOUT |
| DEMO-003 | 95853699 | Deluxe Double 201 | 8 Nov 2026 | 10 Nov 2026 | ₹9,000 | CHECKIN |
| DEMO-004 | 95853717 | Family Suite 301 | 23 Nov 2026 | 26 Nov 2026 | ₹19,500 | — |
| DEMO-005 | 95853636 | Family Suite 304 | 30 Nov 2026 | 1 Dec 2026 | ₹6,500 | — |

DEMO-004 has **2 adults and 2 children**. DEMO-005 has **4 adults**. Guest contact fields are empty and no payments were recorded. Together, these five examples represent **10 room nights** and **₹47,000** in booking prices; these are sample reservation values, not collected revenue. The check-in and checkout info codes record the corresponding demonstration lifecycle steps.

## API verification

The live API verification completed **14 authenticated GET requests** and passed **70 of 70 checks**, including prices, booking charges, inventory, physical-unit occupancy, and capacity rejection. See [verification-report.md](verification-report.md) for the test scope and limitations. The subsequent [end-to-end run](e2e-report.md) exercised 26 of 33 callable methods, including reversible reservation, charge, housekeeping, rate and calendar changes. All compared baselines were restored and all disposable test data removed. The temporary write credential was revoked, and the original read-only credential remains valid. Two observed API caveats are documented in that report. The account remains on its 14-day trial; month-long service requires paid continuation after the trial.

## Configured and live capabilities

The saved setup supplies rooms, rate coverage, housekeeping states, and historical/current/future demonstration bookings for exercising the PMS. It does not establish live channel distribution or payment processing. Authenticated read-only API access has now been verified. The property booking rule is `autoConfirmed`, and every configured payment-gateway type is `disable`.

**The API credential is valid and read-only.** It belongs to owner **182366**, is restricted to property **366736**, and grants `read:properties`, `read:inventory`, `read:bookings`, `read:bookings-personal`, and `read:bookings-financial`; it has no write or delete permission. Authentication and the property, booking, fixed-price, calendar, availability, and unit-booking reads returned successful responses. No secret is included in the package. Core write flows were subsequently tested with a separate property-restricted credential, which was revoked after the tests. This read-only credential does not grant those write operations. See [e2e-report.md](e2e-report.md) for exact coverage; other example payloads are illustrative.

Full property details required `includeAllRooms=true` alongside `includeUnitDetails=true`. Inventory date queries for 1–30 November returned only 8–30 November during the 8 November check; historical reservations remain accessible through the booking endpoint. This is recorded behavior from the verification, not a claimed vendor-wide retention rule.

Beds24's trial allows configuration and testing. Its current live-booking process requires the first payment, account details, and identity verification before accepting live reservations or connecting channels. This package does not claim those activation steps are completed. [Beds24 trial and live activation FAQ](https://www.beds24.com/en/using-beds24/faq)

For a full operational migration, replace the synthetic data with the hotel's real inventory, reservations, policies, and pricing before enabling its real booking channels. The example rates here are saved demonstration prices, not approved commercial rates for a real hotel.
