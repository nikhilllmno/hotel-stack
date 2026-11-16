# websocket-server test guide

## Taxonomy

Two Jest projects (see [`jest.config.ts`](../jest.config.ts)):

| Project | File pattern | Command | Database |
|---------|--------------|---------|----------|
| unit | `**/__tests__/**/*.test.ts` or colocated `**/*.test.ts` (not `*.test.integration.ts`) | `npm test` | none, or pg-mem |
| integration | `**/__tests__/**/*.test.integration.ts` | `npm run test:integration` | Testcontainers Postgres + real migrations |

Use `*.test.integration.ts` only — never `*.integration.test.ts`.

`npm test` includes both pure unit tests (no DB) and pg-mem service tests.

## Stub policy

**Stub (external / side-effects):**

- Stripe, Shift4 (via [`createExternalServiceStubs.ts`](stubs/createExternalServiceStubs.ts))
- PMS / Stayntouch / ResNexus
- SMS and Telegram notification sends
- Microsoft Teams Bot Connector (via [`StubTeamsConnectorProvider`](stubs/StubTeamsConnectorProvider.ts), an in-memory channel you pass to `TeamsNotificationService`)
- Twilio phone validation (global mock in [`registerExternalMocks.ts`](mocks/registerExternalMocks.ts))
- DiscountService (production singleton binds global `db` at import time; see exception below)

**Real (internal — wire with test `knex`):**

- Repositories, HotelService, CustomerService, QuoteService, HotelConfigurationService, ChannelService
- PaymentService via [`createTestPaymentService`](stubs/createTestPaymentService.ts) (`PaymentService.createForTest`)
- RoomReservationService via [`createTestRoomReservationService`](stubs/createTestRoomReservationService.ts)

**Exception:** `DiscountService` is stubbed in `createExternalServiceStubs` because the production singleton binds to global `db` at import time and cannot use per-test `knex` without a production refactor.

Use `createExternalServiceStubs()` for defaults; override only what your test asserts on.

**Not every test needs stubs.** `createExternalServiceStubs` and `createTestRoomReservationService` exist to wire dependencies for tests that exercise a service touching the DB, PMS, Stripe/Shift4, or notification sends. A test for a pure function (no DB, no injected services — e.g. a template/formatter under `constants/`) should not import them; doing so adds unused setup with nothing to stub.

Where possible, build reusable stubs for 3rd-party PMS APIs (e.g. Stayntouch, ResNexus, Hostaway, Cloudbeds) rather than reconstructing mocks inline per test. If a new PMS stub is needed, add it to `createExternalServiceStubs` so all tests can share it.

## Compromises (current)

**Global DB mock:** [`registerTestDatabaseMock.ts`](db/registerTestDatabaseMock.ts) redirects production `import db from '../database/connection'` to the test knex. Context helpers call `bindTestDatabaseKnex` automatically. Production code is unchanged.

Some repository modules construct a singleton at import time; before `beforeEach` runs, the mock falls back to an empty bootstrap pg-mem instance. Test code uses explicit `new Repository(knex)` and bound knex — not the bootstrap.

**Dual schema:** pg-mem tests use the hand-maintained subset in [`schemas/reservationFlowSchema.ts`](db/schemas/reservationFlowSchema.ts). Postgres integration uses full Knex migrations. When adding columns needed by pg-mem tests, update both the migration and `reservationFlowSchema.ts`.

## Recipes

### New pg-mem service test

```typescript
import { installPgMemTestContext } from '@/test/db/createPgMemTestContext';
import { createTestRoomReservationService } from '@/test/stubs/createTestRoomReservationService';

describe('MyService', () => {
  const ctx = installPgMemTestContext(); // seeds hotel by default

  it('...', async () => {
    const { service } = createTestRoomReservationService({ knex: ctx.knex });
    // ...
  });
});
```

Use `installPgMemTestContextWithoutHotel()` when your fixture seeds its own hotel.

### New Postgres integration test

```typescript
import { installPostgresIntegrationTestContext } from '@/test/db/createPostgresIntegrationTestContext';

describe('MyFeature integration (postgres)', () => {
  const ctx = installPostgresIntegrationTestContext();

  it('...', async () => {
    // ctx.knex is bound and seeded before each test
  });
});
```

### Fixtures

- [`seedReservationFlowHotel`](fixtures/reservationFlowFixture.ts) — standard hotel + configuration
- [`seedReservation`](fixtures/reservationSeedFixture.ts) / [`seedOtherHotel`](fixtures/reservationSeedFixture.ts) — reservation rows for integration tests
- [`seedStaleReservationWithPayment`](fixtures/staleReservationFixture.ts) — stale inactive reservation flow

## Deferred (future production refactor)

To remove the global DB mock:

1. Replace `db.transaction()` in `paymentService.ts` (~2) and `roomReservationService.ts` (~12) with repository `startTransaction()`
2. Add `knex` param to `searchReservationByGuestName`
3. Add `DiscountService.createForTest` (or inject `DiscountRepository`) so tests can use real discount logic with per-test knex
4. Delete `registerTestDatabaseMock.ts` and `bindTestDatabase.ts`
