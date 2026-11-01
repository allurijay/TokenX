# Launch decisions and gates

Implementation is not merchant certification. The repository can be run locally and evaluated end-to-end now. A production rollout must close the source document's decisions with an actual approver, date and evidence.

| Decision                       | Default used for development                                                                  | Required before production                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1 Seller / merchant of record | Central operator collects; outlets have internal payable balances                             | Confirm contracting seller(s), collection authority and one vs per-seller invoices                                             |
| D2 Payment provider            | Persistent sandbox; optional Razorpay adapter                                                 | Merchant account, test keys, webhook configuration, capture policy, real test-mode integration evidence                        |
| D3 Finance                     | Configurable taxes; demo tax zero; optional commission; no automatic payout                   | Approve tax rates/rounding, invoice identity, commission, fees, refund credit documents, retention and negative-balance policy |
| D4 Operations                  | Partial pickup; exception refund requires a different approver; cashier automatic limits zero | Approve thresholds, refund timing text, no-show food, service-recovery and post-preparation policies                           |
| D5 Equipment / capacity        | Browser UI, browser receipt printing, local file media                                        | Confirm devices, printer adapters, languages, sustained load, accessibility and managed backup requirements                    |

## Included but not externally certified

- Razorpay order creation, hosted checkout, callback HMAC verification, authoritative payment fetching, idempotent refund submission, webhook signature verification/inbox and recovery worker. No merchant credentials were supplied, so no real provider test-mode capture/refund or settlement was performed during development.
- Production MFA enforcement for central admin/finance accounts. Provision an encryption key and enroll authorized users before opening access. Recovery/reset procedures require the organization's identity policy.
- Single-instance event delivery using PostgreSQL polling and local media. Shared object storage, multi-instance fan-out and managed observability need environment-specific provisioning.

## Remaining deployment/integration work

1. Configure a restricted PostgreSQL application role separate from the migration role; add/test database RLS if required as defense in depth. Application-level scope isolation is implemented and tested.
2. Add organization-approved invoice/credit-note templates and seller/tax identifiers. Current receipts intentionally are not legal tax invoices.
3. Connect real printer hardware if browser printing is insufficient. Physical print acknowledgements and spooler integration are device-specific. Current jobs record browser print requests, not proof of paper output.
4. Configure managed backups/PITR, object-storage retention, TLS/reverse proxy, monitoring, secret rotation and incident recipients. The included local restore drill does not prove production RPO/RTO.
5. Run the full 30-minute sustained-load profile and 200-client event-stream test; the included 50-flow test is a concurrency smoke test.
6. Perform a full WCAG 2.2 AA audit, keyboard/focus testing, customer-device usability review and independent security review. Responsive browser checks are included, not a compliance certification.
7. Provider settlement ingestion currently accepts validated imports; add the selected account's statement-fetch automation and operational schedule if needed. Internal evidence attachments and tamper-evident external audit export need deployment adapters.
8. Device records and scoped kiosk accounts are implemented. Hardware-bound device enrollment/credential rotation is a deployment extension; use managed dedicated kiosk profiles and network controls until it is completed.
9. Automatic chargeback ingestion and arbitrary manual ledger adjustments need a finance-approved case workflow. Excess captures are preserved and have a separate finance refund request and second-person approval flow. Provider disputes still require merchant-account integration.
10. For very large venues, replace complete active-queue snapshots with station-keyset projections and event broker fan-out. The implementation has no cuisine/station count constant, but infinite capacity is not claimed.

`LIVE_PAYMENTS_APPROVED` defaults to false. Set it only after recording approval; it is not a substitute for any review above. Production startup rejects the sandbox provider. Automatic external owner payouts remain out of scope as specified.
