---
name: test
description: Run tests for the Daisy voice agent service. Supports unit, integration, and watch modes.
---

Run tests for the websocket-server codebase.

Arguments:
- $ARGUMENTS: Test mode and optional pattern

Usage Examples:
- `/test` — run unit + pg-mem tests (default)
- `/test integration` — run Postgres integration tests (Docker required)
- `/test all` — run both unit and integration
- `/test watch` — run unit tests in watch mode
- `/test MyService` — run unit tests matching a pattern

Instructions:
1. Parse mode from arguments (default: unit)
2. `cd websocket-server`
3. Map to command:
   - (default) → `npm test`
   - with pattern → `npm test -- --testPathPattern="<pattern>"`
   - integration → `npm run test:integration`
   - integration with pattern → `npm run test:integration -- --testPathPattern="<pattern>"`
   - all → `npm run test:all`
   - watch → `npm run test:watch`
4. Report results and any failures

Hard Rules:
1. **Always run from `websocket-server/`** — tests will fail from the repo root.
2. **Use a pattern when possible** — running all tests is slow. Narrow to the relevant file or describe block.
3. **File naming matters** — `*.test.ts` for unit/pg-mem, `*.test.integration.ts` for integration. Never `*.integration.test.ts`.
4. **Docker required for integration** — if Docker is not running, say so and fall back to unit tests.
