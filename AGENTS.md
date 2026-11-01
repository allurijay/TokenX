# Tokenex repository guidance

- Read README.md and docs/ARCHITECTURE.md before changing business behavior. docs/LAUNCH.md contains unapproved production decisions; do not invent sign-off.
- Keep money in integer minor units. State, journal, audit and outbox changes must commit in the same transaction. External provider calls must be recoverable and run outside database row-lock transactions.
- Treat cooking, serving, cancellation and refunds as independent state machines. Never infer collection from cooking completion or refund success from request acceptance.
- Enforce persisted venue/outlet/station scope on every command, query, export and stream. UI visibility is not authorization. Customer tokens are not credentials.
- Preserve idempotency, immutable financial history and maker-checker rules. Do not silently release an unknown refund reservation.
- Cuisine/outlet/station names are data; only demo seeds and scenario tests may contain example names.
- Run npm run check for backend/domain changes and npm run test:e2e for interface/checkout changes. Integration tests require a seeded PostgreSQL database and write synthetic records; never use a live database.
- Run npm run api:spec when changing public routes/contracts. Keep docs/REQUIREMENTS.md and known limitations accurate. Do not claim a mocked provider, local restore or smoke test satisfies production certification.
- Use migrations for schema changes. Never erase existing development or production data to make tests pass.
- Do not commit .env, uploaded media, database dumps, credentials, session/tracking secrets or browser traces.
