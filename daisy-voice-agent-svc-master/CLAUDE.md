# Daisy Voice Agent Service — Dev Guide

Stack, API routes, and payment flows: see `README.md`.

## Hard Constraints

- **Never commit** without explicit user confirmation
- **Before committing:** `npm run build && npm run lint && npm test` — all must pass; stop on first failure
- **Test files:** `*.test.ts` (unit/pg-mem) or `*.test.integration.ts` (Postgres) — never `*.integration.test.ts`
- **PRs target `master`** only (trunk-based); merge with a merge commit (no squash), delete branch after
- **Don't introduce new patterns** without a reason — match what's already in the file you're editing
- **No narration comments** — only explain non-obvious intent or constraints

## Code Conventions

- TypeScript strict — all new code under `websocket-server/src/`
- Use `createExternalServiceStubs` and `createTestRoomReservationService` for tests (never invent new mocking patterns)
- After changing API routes, payment flows, or ENV variables: update `README.md`

## KPI Logging

Instrument significant business outcomes with `logKpi`. Always use a `KpiStat` constant — never a raw string.

```typescript
import { KpiStat, logKpi } from '../../utils/kpiLogger';

logKpi({
  stat: KpiStat.PmsBookingCreated,
  value: 1,
  contextName: 'MyService.myMethod',      // CloudWatch dimension
  clientId: hotel.assistant_phone_number, // hotel identifier
  contextId: paymentId,                   // optional; scopes the event
});
```

Add calls for: PMS API outcomes (booking created/cancelled/modified), payment outcomes (success/failed/refund/autocharge), reservation lifecycle events (stale cancellation).
Skip: internal helpers, retry loops, events already covered by structured logs.

If the stat you need isn't in `KpiStat`, add it first (`websocket-server/src/utils/kpiLogger.ts`) — follow `<domain>.<sub-domain>.<outcome>`.

## Reference Files

| File | Load when... |
|------|-------------|
| `websocket-server/src/test/README.md` | writing or debugging any test |
| `websocket-server/src/utils/kpiLogger.ts` | adding KPI instrumentation |
| `.github/pull_request_template.md` | opening a PR |

## Commands

All from `websocket-server/`:

| Command | What it does |
|---------|-------------|
| `npm run build` | Clean build (`rm -rf dist/ && tsc`) |
| `npm test` | Unit + pg-mem tests (no Docker) |
| `npm run test:integration` | Postgres integration tests (Docker required) |
| `npm run lint` | ESLint across `src/` |
| `npm run format` | Prettier |
| `npm run migrate` | Run pending Knex migrations |
| `npm run migrate:rollback` | Rollback last batch |

Start: `npm i && npm run build && npm run migrate && npm run start`

## Git & PRs

- Branches: `feat/<description>` or `fix/<description>`
- Commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- PR description: follow `.github/pull_request_template.md`
- CI failures: only fix failures in scope for the current PR; if unrelated, check if the branch is behind `master`
- Use `gh` for GitHub operations: `gh pr list/view/merge --repo dextr-ai/daisy-voice-agent-svc`
