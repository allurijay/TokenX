# Deployment and environment

## Local development

Run `npm ci`, `npm run setup`, `npm run dev`. Setup is additive. PostgreSQL data uses a named Docker volume. Do not use `docker compose down -v` unless explicitly intending to erase local data. Migrations are ordered, transactional and recorded in `schema_migration`.

`npm run build` produces `apps/web/dist`. Set `SERVE_WEB=true` to serve the frontend from the API for a single-origin deployment, or host the frontend separately behind the same reverse proxy. API requests are `/v1/*`; SSE requires buffering disabled and a generous idle timeout.

## Processes

- API: `npm start`
- Worker: `npm run worker`
- Migrations: `npm run db:migrate` once per deployment, using a migration role.
- Optional container: `docker build -t tokenex .`. Mount persistent `/app/var/media`, inject environment secrets, provide an external database and run API/worker as independent containers. The image runs as the non-root `node` user.

Do not seed demo accounts in production. Production customer registration is not required; staff provisioning uses an existing super-admin identity. Provision the initial super-admin with `npm run admin:provision` under a controlled administrative environment: set `PROVISION_INITIAL_ADMIN=true`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 16 characters), and optional `ADMIN_NAME`, `ORGANIZATION_NAME`, `VENUE_NAME`. The script refuses if any super-admin already exists and never prints the password. Remove provisioning secrets afterward; do not use the demo seed.

## Environment

| Variable                              | Purpose                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| DATABASE_URL                          | PostgreSQL connection string; use TLS in managed environments                                   |
| APP_ORIGIN                            | Exact allowed browser origin, including scheme/port                                             |
| HOST / PORT                           | API bind address; default loopback/4100                                                         |
| PAYMENT_PROVIDER                      | `sandbox` or `razorpay`                                                                         |
| ENCRYPTION_KEY                        | 32 random bytes as 64 hex characters; protects MFA and command recovery envelopes               |
| MEDIA_DIR                             | Persistent menu image directory; shared storage required for multiple API instances             |
| SERVE_WEB                             | `true` serves the compiled frontend from the API                                                |
| NODE_ENV                              | `production` enables secure cookies and elevated MFA requirement, disables demo/sandbox startup |
| ALLOW_DEMO_SEED / DEMO_PASSWORD       | Local/test only                                                                                 |
| RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET | Test or approved live merchant API credentials                                                  |
| RAZORPAY_WEBHOOK_SECRET               | Separate provider webhook signing secret                                                        |
| LIVE_PAYMENTS_APPROVED                | Explicit configuration gate for non-test Razorpay keys; default false                           |

Never rotate ENCRYPTION_KEY by simply replacing its value: existing encrypted MFA and idempotency records require a key-version migration. Back up keys in a secret manager separately from database dumps. Do not expose `.env`, database dumps, recovery tokens or provider signatures through logs or artifacts.

## Razorpay staging configuration

1. Use test merchant credentials and `PAYMENT_PROVIDER=razorpay`. Configure automatic capture in the merchant account; only confirmed captures create kitchen work.
2. Register `/v1/webhooks/razorpay` on an HTTPS staging origin; configure payment capture/failure and refund events with the separate webhook secret.
3. Verify test-mode success, failure, delayed capture, duplicate callback, refund pending/failure/success and webhook retry. Provider IDs/amount/currency/order are checked against the internal intent.
4. An unknown order-creation response is queried by merchant receipt; the adapter does not blindly submit another provider order. An unknown refund is replayed only with the provider-specific idempotency header and permanent operation key.
5. Run reconciliation against the account's real statement data and confirm bank/provider fee treatment.

## Deployment sequence and rollback

Back up first; rehearse migrations on a restored staging database. Deploy backward-compatible migrations, then API and worker, then frontend. Run health and a synthetic sandbox/test-mode order. Monitor unresolved payments/refunds and audit errors.

Rollback application images only when schema compatibility is maintained. Never restore an old database over live captured payments to undo a code deployment. Pause ordering, preserve evidence, repair with forward migrations and reconcile provider state.

## Monitoring

`/health` verifies database connectivity. Authorized `/v1/operations/health?venueId=...` lists unknown payments, aged refunds and paid orders without materialized fulfillment. Metrics/log collection and alert delivery must be configured in the hosting environment. Retain webhook failures and investigate attempts reaching the retry ceiling; do not discard them.
