# Tokenex + KitchQ

A single-repository food-court operating system: central POS, self-service kiosks, station-based kitchen execution, serving, customer tracking, scoped owner administration, and financial operations.

**Status:** working sandbox implementation with PostgreSQL-backed API and React screens. The default does not charge real digital money. Razorpay integration code is included but has not been certified against an actual merchant account. Production activation requires the business decisions and operational gates in [docs/LAUNCH.md](docs/LAUNCH.md).

## Start locally

Requirements: Node.js 24, npm, and Docker with Compose.

```sh
npm ci
npm run setup
npm run dev
```

Open **http://localhost:5173**. The API runs on port 4100; PostgreSQL uses local port 55432. Setup creates `.env` if absent, generates an encryption key, starts PostgreSQL, applies migrations and seeds a demo venue without overwriting existing data.

Demo password: the `DEMO_PASSWORD` value in your local `.env` (initial example: `ChangeMe-Local-Only-42!`). Never use demo accounts in production.

| Email                   | Access                          |
| ----------------------- | ------------------------------- |
| admin@tokenex.local     | Central super-admin             |
| manager@tokenex.local   | Venue manager, finance approval |
| owner@tokenex.local     | Dhaara Tiffins owner            |
| wok-owner@tokenex.local | Wok & Bowl owner                |
| billing@tokenex.local   | Central POS and refund requests |
| cook@tokenex.local      | Dhaara dosa station             |
| quick@tokenex.local     | Quick-service cook and server   |
| server@tokenex.local    | Dhaara serving counter          |
| kiosk@tokenex.local     | Kiosk ordering only             |
| display@tokenex.local   | Public token board only         |

## Try the complete flow

1. Sign in as admin or billing. At POS, add two masala dosas, an idli plate and fried rice. Enter a name, review the server-calculated quote and pay in sandbox.
2. Keep the receipt's pickup code and tracking link. KitchQ creates three station tickets under one customer token.
3. In a separate browser profile, sign in as `cook` and start/complete the dosas. Quick-service work is assigned separately. Cooking completion does not mark customer pickup ready.
4. Sign in as `server`, mark completed units ready and hand over selected units using the receipt pickup code. The customer tracking page refreshes independently.
5. Billing requests a partial cancellation/refund with a reason. A different admin/manager approves. The worker confirms a sandbox digital refund; cash refunds require an open shift and physical disbursement confirmation.
6. Compare owner and admin dashboards. Owners see only their own items and financial allocations. Inspect the append-only audit trail and balanced journal.

## Included surfaces

- POS and touch-friendly kiosk menus, image/name/price cards, variants/modifiers, mixed carts, quote expiry, pending-payment recovery and QR receipts.
- Dynamic venues, cuisine outlets, preparation/quick-service stations, menu management, image upload, item holds, staff management and optional authenticator MFA.
- KitchQ preparation boards, separate serving boards, partial pickup, public token display, private customer tracking and reconnecting event streams.
- Full/partial item refunds and monetary adjustments, maker-checker approvals, quantity cancellation, original-tender return, immutable audit and finance records.
- Cash shifts, owner/admin sales, journal views, CSV exports, statements, payout approval/evidence, and provider reconciliation imports.
- API workflows for schedules, variants, modifiers, reassignment, rework, zero-price cancellation, incidents, venue policies and operational exception monitoring.
- Durable provider operation references, payment attempts, webhook inbox, replayable event outbox and recovery worker.

## Repository

```text
apps/web       React interfaces and local illustration assets
apps/api       Fastify HTTP API, authorization and business commands
apps/worker    Payment, refund and webhook recovery
packages/domain       Money allocation, states, scopes and password utilities
packages/contracts    Validated request and event schemas
packages/db           PostgreSQL migrations and demo seed
packages/adapters     Persistent sandbox and Razorpay adapters
scripts               Setup, OpenAPI, concurrency and restore checks
tests                 Domain, PostgreSQL integration and browser checks
docs                  Decisions, contracts, runbooks and evidence
```

The apps share a repository but deploy as separate processes. PostgreSQL is authoritative. Cache/Redis is not required for this initial deployment; event delivery polls the durable outbox. See [architecture](docs/ARCHITECTURE.md) for tradeoffs.

## Verification

```sh
npm run check           # strict TypeScript, frontend build, domain + PostgreSQL tests
npm run test:e2e        # browser flows; install Chromium first on Linux
npm run test:load       # 50 concurrent order flows, writes demo orders
npm run test:restore    # isolated dump/restore drill; source DB unchanged
npm run api:spec        # generate docs/openapi.json
npm audit
```

Tests write synthetic records to the configured database. Use a dedicated test database in CI; never point tests at live data. `npm run db:seed` is additive and deliberately refuses production. Backup with `npm run backup`; preserve your encryption key separately from database backups.

Read [API contracts](docs/API.md), [requirement coverage](docs/REQUIREMENTS.md), [deployment](docs/DEPLOYMENT.md), and [runbooks](docs/RUNBOOKS.md) before operating the system.
