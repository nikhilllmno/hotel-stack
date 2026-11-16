# hotel-stack

AI front desk for independent hotels: Vapi voice agent, SMS/WhatsApp text agent, owner dashboard, and Doss (owner agent on Hermes). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

```
hotels/<hotel-id>/   config as code: facts.yaml, kb/, policies/, prompts/voice/, tools.yaml, voice.yaml, evals/
src/hotelcore/       hotel core: tools, Beds24 client, Vapi webhook + dashboard API, publish/rollback, evals, call analysis
db/migrations/       Postgres schema (Supabase)
dashboard/           Next.js dashboard (Call Insights, Bookings, Evaluations, AI Snapshots)
tests/               uv run pytest
```

## Develop

```bash
uv sync
uv run pytest                      # unit tests; live Beds24 test runs when BEDS24_REFRESH_TOKEN is set
```

Secrets go in `.env` (never committed).
