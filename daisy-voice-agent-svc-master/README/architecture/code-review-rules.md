# Code review rules for repo health

How we keep Daisy's architecture clean as we touch it, on top of CodeRabbit's default review.
CodeRabbit's default review is good at not making things worse.
These rules aim at the other half: every PR leaves the code it touches a little better than it found it.

## Recommendation

Split the rules by what can enforce them.
Anything a tool can check goes into CI as a hard gate, because a reviewer (human or AI) misses things a script never does.
Judgement calls go into CodeRabbit as path instructions, so they show up as review comments on the lines that matter.
Hold off on building our own review agent.
Start with CodeRabbit instructions, track which rules it keeps missing, and build an agent only for those.

## Deterministic gates (CI and Husky)

| Gate | Tool | Status |
|---|---|---|
| Build, lint, unit tests on every PR | `pr-checks.yml` | In #1760 |
| Shared ESLint config (same as intern, event-service, app-service, app-bot) | `eslint.config.mjs` | In #1760 |
| Existing lint violations can only shrink | `eslint-suppressions.json`, pruned with `npx eslint --prune-suppressions` | In #1760 |
| No import cycles, existing ones can only shrink | `dependency-cruiser` with `--baseline-mode shrink-only`, as in `dextr-intern/app-server` | Proposed |
| Layering: repositories never import services, services never import routers or controllers | `dependency-cruiser` forbidden rules | Proposed |

## Review principles (CodeRabbit path instructions)

CodeRabbit reviews against a short list of principles instead of a long list of nits.
Style, naming and formatting are left to ESLint and Prettier.
Each principle comes from Daisy's tech debt or from what human reviewers kept asking for in recent PRs.

1. **Testable by design.**
   Dependencies come in through the constructor or parameters, not the global `db` or import-time singletons (49 of those today).
   Business decisions live in pure functions apart from DB, PMS and gateway calls, so they test without mocks.
2. **Small, focused modules.**
   New logic goes into a focused module, not into `roomReservationService.ts` (15k lines) or other files over 1,000 lines.
   A touched function over 150 lines should not grow.
3. **Clear layers, no cycles.**
   Routers call controllers, controllers call services, services call repositories and clients, never the other way.
   No setter injection or event emitters to dodge an import cycle; wire the graph at startup.
4. **Fail loudly.**
   No silent fallback to another path, no swallowed errors, no env var with a silent default (#1672).
5. **Side effects are safe to repeat.**
   Charges, refunds, bookings, cancellations and webhooks are safe to retry or receive twice (#1689, #1697).
   Money paths write state before calling out, claim the row, and send an idempotency key.
6. **Types carry the contract.**
   Validate external input at the boundary, then trust typed values inside; no new `any` in PMS interfaces, clients or service signatures (170 today).
7. **Per-hotel behaviour is config, not code.**
   No hardcoded hotel ids, names or heuristics; it goes in the hotel's configuration (#1746).
8. **Reuse before adding.**
   Use the existing helper, repository method, client or shared fake; a new abstraction must remove more complexity than it adds.
9. **Outcomes are observable.**
   External calls and business outcomes log a `KpiStat` count for every attempt, not only failures (#1762, #1740, #1674).
10. **Shortcuts are declared.**
    A known limit gets a line under "Shortcuts taken" in the PR, with when to fix it, so shortcuts stay visible to the team and management.

Two rules apply only to their paths.
In payment and PMS code, nothing sensitive is logged (card data, tokens, JWTs, full gateway responses, guest PII), and a change to card data flow needs a test asserting the PAN and CVV appear in no log (#1740).
In tests, behaviour is tested through public methods, with shared fakes like `createExternalServiceStubs` instead of new `jest.mock` of `src/` modules.

## Where the rules live

The principles are in [`.coderabbit.yaml`](../../.coderabbit.yaml) at the repo root, as path instructions plus two pre-merge checks: "Shortcuts declared", and "Claimed tests exist" for PR descriptions that claim tests the diff does not have (#1697).
Change a principle there and here together, so this doc keeps the reason behind each one.
The shortcuts check reads the "Shortcuts taken" section of `.github/pull_request_template.md`.
Both checks only warn, they never block a merge.

## Next steps

1. Add `dependency-cruiser` with a shrink-only baseline, copying `dextr-intern/app-server/.dependency-cruiser.js`, so import cycles and layering become a hard gate instead of a review comment.
2. After two or three weeks, list which rules CodeRabbit missed or got wrong, tune the instructions, and decide whether our own review agent is worth building for what is left.
