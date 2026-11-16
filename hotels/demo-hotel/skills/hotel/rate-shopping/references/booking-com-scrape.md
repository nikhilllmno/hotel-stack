# Booking.com price check via browser_exec

Use a named session (e.g. session="booking"); if the first CDP handshake times out, retry with ensure_real_tab()
in a named session.

1. Search URL (find the property link):
   https://www.booking.com/searchresults.html?ss=<Name+City>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=2&no_rooms=1&group_children=0&selected_currency=USD
   Cards: document.querySelectorAll('[data-testid="property-card"]'); link: a[data-testid="title-link"].
2. Property URL: strip the tracking params, keep
   https://www.booking.com/hotel/us/<slug>.html?group_adults=2&no_rooms=1&group_children=0&selected_currency=USD&checkin=...&checkout=...
   Loop goto_url over several date ranges in ONE call (sleep ~5s each).
3. Room rows: document.querySelectorAll('#hprt-table tbody tr') innerText -> room name, "$X per night",
   stay total, "Excluded: N % TAX", cancellation terms, "We have N left".

Pitfalls
- The search-results card can say "Unavailable on our site for your dates" while the property page lists rooms
  for the same dates; always open the property page before reporting it as sold out.
- Listed prices exclude taxes (shown as "Excluded: ..."); report pre-tax and an approximate with-tax total.
- A name the owner gives may be misspelled (Leeland -> Leland); a web_search alone rarely resolves it, so ask for
  the city in the clarify call.
