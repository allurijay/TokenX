# API and event contracts

The generated OpenAPI file is `docs/openapi.json`; regenerate it with `npm run api:spec`. Swagger UI is at `/api-docs`. Runtime body validation uses Zod; all command handlers perform scope and state checks inside database transactions.

## Session and command conventions

- `POST /v1/auth/login`: `{email,password,otp?}` creates an HttpOnly SameSite session. Production uses Secure cookies. `POST /v1/auth/logout` revokes it.
- `GET /v1/me` returns effective assignments and permitted venues. No client role claim is trusted.
- Mutations use `Idempotency-Key` (8–160 characters). A repeated key/body returns the prior result; another body yields `IDEMPOTENCY_CONFLICT`. Provider operations also have permanent business keys independent of HTTP caching.
- Single-resource edits carry `version` in the body; unit batch commands carry `expectedVersions`. This implementation uses explicit version fields instead of the PDF's optional If-Match header.
- Results are `{data,meta:{requestId}}`. Errors are `{error:{code,message,retryable,fieldErrors?},requestId}`. Financial amounts are integers, in minor currency units.
- POST hosted-checkout and payment verification use permanent intent keys; they are safe recovery endpoints rather than generic command-cache responses.

## Checkout example

```json
{
  "venueId": "<uuid>",
  "deviceId": "<uuid>",
  "channel": "POS",
  "customerAlias": "Guest",
  "lines": [{ "itemId": "<dosa uuid>", "qty": 2, "modifierIds": [] }]
}
```

Send to `POST /v1/quotes`. Confirm its total, then `POST /v1/checkouts` with `{quoteId,tender:"DIGITAL",checkoutKey:"unique-client-key"}`. The response contains order/intent IDs and private tracking/pickup credentials. Persist the response for recovery, not card data.

Sandbox: `POST /v1/payments/{id}/sandbox-capture` explicitly simulates capture, disabled for other providers and production. Razorpay: call `/hosted-checkout`, open the official checkout UI, then send signed callback fields to `/verify`; server fetches the actual capture. Webhooks and worker recovery also converge on the same finalize operation. Cash: `/confirm-cash` with open `shiftId` and `receivedMinor`.

## Operational commands

- `/units/transition`: `{unitIds,expectedVersions,action,pickupCode?,overrideReason?}`; actions ACKNOWLEDGE, START, COMPLETE, READY, HANDOVER. Invalid batches roll back entirely.
- `/units/reassign`: `{unitId,stationId,expectedVersion,reason}`; unstarted work only, same outlet.
- `/units/rework`: `{unitId,expectedVersion,reason}`; manager permission, creates no-charge linked work.
- `/units/cancel-zero`: cancel an uncollected zero-priced unit without inventing a refund.
- `/availability-holds`: `{outletId,itemId?,stationId?,reason,expiresAt?}`. All applicable holds combine. Creator or manager can release their record at `/{id}/release`.
- `/menu-items`, `/variants`, `/categories`, `/outlets`, `/stations`, `/devices`: validated create/update, no generic arbitrary-column mutation. Set active=false to archive reference data.
- `/menu-items/{id}/image`: authenticated multipart file, JPG/PNG/WebP <=5 MB. Uploaded media uses a UUID WebP path.
- `/menu-items/{id}/options`: replace validated modifier-group definitions with a version guard.
- `/outlets/{id}/schedule`: weekday/open/close intervals; split overnight intervals into two day entries.
- `/menus/publish`: validate active station routes before publication.
- `/incidents`: staff unavailable/quality escalation; finance/billing can resolve after handling the customer.

## Refund workflow

`POST /orders/{id}/refund-requests` selects unit IDs, optional monetary amounts, CANCEL_AND_REFUND or REFUND_ONLY, reason code and required note. The server checks remaining allocations, capture balance, preparation state, role scope and thresholds. Approval requests reserve capacity immediately. Exception approval requires another person.

`POST /refund-requests/{id}/decision` contains APPROVE/REJECT, expectedVersion and note. Digital return runs in the worker. Cash return uses `/confirm-cash` with `{shiftId,disbursed:true}`. Rejecting a pre-approval request releases cancellation holds and capacity. Provider failure does not erase an approved refund liability.

## Finance and administration

`GET /reports/sales?venueId&from&to` uses inclusive-start/exclusive-end timestamps. Returns scoped outlet metrics and recent journal lines. `/settlement-batches` creates a reviewed payout amount; `/approve` requires another finance approver; `/record-payment` needs a confirmed bank reference. No call initiates a bank transfer.

`/reconciliation/imports` deduplicates records by external ID and validates evidence hashes. Captures/refunds match actual references and amounts. Fee/settlement cases require finance classification. Payment mismatches cannot be resolved by fabricating success.

`/staff`, `/staff/{id}/revoke`, `/staff/{id}/password`, `/auth/mfa/enroll`, `/auth/mfa/confirm` implement account lifecycle. Scopes never expand from owner to venue administration. `/venues/{id}/policy` sets future commission and cashier refund limits.

## Events and customer visibility

`GET /events?venueId&after` streams SSE `change` events with monotonic event IDs, type and time. Last-Event-ID resumes replay. Clients fetch a fresh scoped snapshot on initial connect/reconnect and ignore duplicate invalidations. `/queues` covers outstanding work, `/orders` is recent history, and `/display` is a privacy-limited public board.

A receipt link uses `/track#<secret>`. Browser exchanges the fragment via `POST /tracking/session`, removes it from history and reads `/tracking` using a path-scoped HttpOnly cookie. No phone number or internal refund note appears in customer tracking.
