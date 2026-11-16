---
name: rate-shopping
description: "Compare our prices with nearby hotels; suggest price changes"
version: 1.0.0
author: Dextr
metadata:
  hermes:
    tags: [hotel, pricing, competitors]
    category: hotel
---
# Rate shopping (kind: rates)

Owner asks: "how do our weekend prices compare?", "are we too expensive for Christmas?", "what do hotels in
Fredericksburg charge next month?".

1. Our prices: Beds24 `quote_stay` (or hotel tool availability) for the same dates and party size; say the cabin names.
2. The market: trivago `trivago-accommodation-radius-search` around the ranch (13454 Lower Crabapple Road,
   Fredericksburg, TX: about 30.33, -98.87) or by city "Fredericksburg, Texas", same dates and guests;
   `trivago-destination-price-trends` for the month-by-month picture. Prefer comparable places (cabins, cottages,
   B&Bs, ranches; similar rating) over big chain hotels, and say which you compared.
3. For a competitor's own site or an OTA listing, use the browser (Browserbase) only when trivago is missing it,
   or when the owner names a specific site (e.g. "check on Booking.com"). Recipe and pitfalls:
   references/booking-com-scrape.md. Before browsing, clarify in ONE call: exact property (+ city) if the name
   doesn't resolve, dates, guests. Then check a few nearby date ranges too (other weekends, a midweek) so the
   owner sees the pattern.
4. Report: a table (date range, our price, market low / median / high, comparable places), what stands out, and
   concrete price suggestions with the reason. Plain-text aligned columns (the chat renders no markdown); give
   per-night and stay total, and say whether taxes are excluded. Publish with `post_report` (kind rates) when
   asked for a report.
5. Changing prices / matching a competitor ("make Cabin 2 the same as their cheapest room"):
   a. Resolve the unit by name via `get_hotel` (units: Cabin 1-5, Cottage 6-12, 14-16; no Cottage 1-5 or 13).
      If the named unit doesn't exist, clarify with the closest names as choices; ask which date ranges in the
      same clarify call.
   b. Old prices: `quote_stay` per range (total / nights = nightly). `get_availability` for the same span shows
      nights already booked; setting a price there doesn't change the existing booking, so say so.
   c. State every range: unit, nights, old -> new per night and new total; flag increases and any big gap in
      comparability (e.g. a city motor lodge vs our ranch cabins) once, without blocking.
   d. One `set_daily_price` per contiguous range; to_date is the LAST NIGHT (checkout minus one), inclusive.
      Each needs owner approval. Never change prices on your own.
   e. Verify: re-run `quote_stay` for at least one range and confirm the new total; offer to restore
      (price=None removes the override).
