# Verification record

Checked locally on 01 November 2026 using Node.js 24 and PostgreSQL 17.

- Strict TypeScript and production frontend build: passed.
- Domain, provider/security, and real PostgreSQL integration checks: 23 passed.
- Desktop POS-to-receipt/kitchen/finance browser workflow: passed.
- Mobile kiosk viewport check at 390 pixels: passed.
- 50 concurrent quote/checkout/capture flows: unique tokens, no duplicate dispatch; measured p95 full flow 769 ms in the bounded in-process smoke test.
- Isolated PostgreSQL dump/restore: passed in 2 seconds, 89 orders restored at the measured checkpoint, zero unbalanced transactions.
- npm dependency audit: zero reported vulnerabilities at the checked dependency lockfile.

The integration suite also verifies late-capture review, excess-capture return without reducing owner earnings, cash refund/shift close, refund reservation races, private tracking, and production MFA enrollment enforcement.

A reconnect replay flood found during browser testing was fixed: new event subscriptions begin from a current snapshot boundary, scoped replay advances past invisible events, and clients coalesce refreshes. Subsequent browser checks passed against the larger dataset.

This record is local evidence, not a claim of live Razorpay certification, full 30-minute load certification, independent accessibility/security audit, managed-production RPO, or production uptime. Those gates are in LAUNCH.md.
