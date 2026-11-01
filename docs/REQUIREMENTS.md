# Requirement coverage and validation

Source: the user-supplied 30-page Tokenex + KitchQ build specification. Requirements were translated into code; document instructions were not treated as authorization to activate payments, deploy production or communicate with third parties.

| Requirement                | Implementation                                                                                                             | Evidence / boundary                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CFG-01 dynamic hierarchy   | Venues, outlets/cuisine labels, station CRUD, route defaults, variants, schedules, modifiers and publication               | Data-driven UUID records; no cuisine/station enum or count ceiling. Reusable cuisine taxonomy is simplified to an outlet label.                                                                       |
| ORD-01 POS/kiosks          | Responsive menus, local illustrations/uploaded photos, mixed cart, server quote, cash/hosted payment, receipt and recovery | Browser checkout + mobile layout tests; sandbox verified. Merchant test-mode credentials still required.                                                                                              |
| RTE-01 cooking/serving     | Per-unit station tickets, independent preparation and pickup states, partial handover, version checks, rework/reassignment | AT-02/03 integration tests use the Dhaara/wok example.                                                                                                                                                |
| RT-01 live tracking        | Durable outbox, scoped SSE invalidation, polling recovery, personal QR tracking and public board                           | Private tracking isolation tested; browser renders live screens. Sustained 200-client fan-out not certified.                                                                                          |
| IAM-01 roles               | Individual sessions, role scopes, owner staff ceiling, revocation, MFA, hashed passwords                                   | Owner/cook/kiosk negative tests; MFA crypto tests. RLS/hardware device enrollment remain deployment extensions.                                                                                       |
| FIN-01 reporting           | Period sales/refunds, tax/discount/net components, ledger, commission, cash shifts, CSV, statements/payout evidence        | Journal balancing/immutability, reconciliation deduplication and cash close tests. Legal invoice/credit-note identity remains D1/D3.                                                                  |
| REF-01 refunds             | Reason codes/notes, exact units or partial monetary credit, approval, limits, holds, original tender, persistent recovery  | AT-07/08/09; duplicate/over-refund, race, cash refund and late capture tests. Excess-capture returns have a separate finance approval path; chargeback ingestion remains a provider integration item. |
| NFR-01 operational quality | Type checking, CI, browser tests, concurrency smoke test, backup/restore scripts, Dockerfile, audit/secret controls        | Local evidence files included. Full capacity, availability, accessibility and external security audits are not claimed.                                                                               |

## Automated acceptance checks

- Largest-remainder discount and tax arithmetic, deterministic rounding, invalid transitions and scoped access.
- Mixed order: one capture/token, two suborders, three station tickets, four work units, exact INR 360 example.
- Cooking completion stays WAITING for serving; ready and handover are separate and pickup-code protected.
- Item hold invalidates checkout and cannot be removed by unrelated station staff.
- Ten simultaneous identical checkouts/payments converge on one result and token; changed body/key conflicts.
- Partial refund returns INR 90, requires another approver, preserves allocations and balances the journal.
- Concurrent refund requests cannot over-reserve the same captured value.
- Owner excludes other outlet lines/amounts; kitchen has no financial/refund reason data; kiosk cannot view other orders.
- Provider import is idempotent. Tracking link scopes to one order. Audit cannot be changed.
- Cash sale/full cash refund closes with zero variance; unavailable late capture is reviewable/refundable and cannot be cooked.
- Provider raw-byte signature verification and encrypted authenticator secrets.
- Browser POS-to-receipt flow, kitchen/finance rendering, and 390-pixel kiosk viewport.

## Verification scope

See `docs/evidence/concurrency.json` and `restore.json` for measured local checks. These are bounded smoke tests; they do not replace the PDF's production release gates. Live provider requests were not made. See LAUNCH.md for the exact remaining configuration, infrastructure and specialized integration work.

- Distinct excess capture creates a separate customer liability and refund without duplicate kitchen work or reduced owner earnings.
