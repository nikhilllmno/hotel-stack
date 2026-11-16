# Lessons from Daisy (the previous voice agent)

Daisy (`daisy-voice-agent-svc-master`, Node/Express/Postgres, Vapi, six PMS integrations) is reference only. What we keep, and what we avoid.

## Keep
- **Readable tool errors.** Failed tools return plain sentences the model can say ("That date isn't available"), never stack traces.
- **Filler while slow tools run.** Vapi `request-start` messages ("Let me check that for you") on availability and booking tools.
- **Structured outputs per call** for the dashboard: caller intent, satisfaction (1-10), frustration (1-10), sentiment, availability enquired, booking link sent, follow-up needed.
- **Warm transfer to staff** chosen by hotel hours and caller intent; take a message when nobody is available.
- **Post-call notification to staff** (Daisy: Telegram/Teams) with summary, bookings, callback requests and recording link.
- **Voice-to-text continuity.** The call summary seeds the guest's text conversation; booking/payment links are texted during the call; follow-up texts on unfinished bookings.
- **Booking safety.** A claim column prevents double PMS bookings; a sweeper cleans stale pending reservations.
- **Lite availability calls** and short caches for rate calendars to keep tool latency low.

## Avoid
- **Config in the Vapi dashboard.** Daisy's prompt, tools and structured outputs lived in Vapi and drifted from the code (a KPI existed only to detect the drift). Ours live in `hotels/<id>/` and are synced on publish.
- **Accepting unauthenticated webhooks.** Daisy logged a wrong `x-vapi-secret` and still returned 200. Ours rejects with 401.
- **Tools that depend on an earlier webhook.** Daisy required a session row created by `status-update`; a race gave "No active session". Ours derive everything from the tool-call payload (`call.id`, caller number) and create the conversation lazily.
- **One giant service.** Daisy's reservation service is 15,853 lines. Ours: one small module per tool, a shared PMS client.
- **Hard-coded hotel phone numbers** in prompts and flows. Ours come from `facts.yaml`.
- **Per-instance in-memory state** (Daisy's failed-card limits). Ours goes in Postgres.

## Daisy's tool set (Vapi `apiRequest` tools)
getRoomsInfo, checkAvailability (+multi-room), getAllRatesForRoomType, createReservation (pending, paid via texted link), createMultiRoomReservation, getReservation, updateReservation, cancelReservation, getReservationStatus (payment), takeMessage, transferEscalationToManager (Vapi transfer), sendTemplateEmail (sales: groups, weddings), getDiscount, escalation instructions by hotel hours.

Notable flow: Daisy never booked in the PMS during the call. It created its own pending reservation, texted a review/payment link, and created the PMS booking only after payment cleared.
