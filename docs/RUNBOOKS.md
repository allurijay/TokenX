# Operations runbooks

Every financial case should identify the order/payment/refund reference, actor, timestamp and evidence. Never mark a return successful merely because a customer asked or a browser callback appeared.

## Provider outage / payment unknown

- Keep the checkout reference. Do not create another charge or accept a replacement tender while digital payment is unresolved.
- The worker queries the existing permanent provider operation. Inspect the operational health endpoint and provider dashboard with finance access.
- Missing callbacks do not imply failure. Resume the same checkout after verification. Late payment after item unavailability is staged in PAYMENT_REVIEW and can be refunded or explicitly released by a manager.

## Stuck / failed refund

- Inspect approval, reserved amount and provider reference. UNKNOWN retains the customer liability and capacity reservation.
- Worker queries before resubmission and uses the same provider-specific operation key. An approved cash return requires a cashier's physical disbursement confirmation and an open shift.
- A definitive failed provider refund needs finance/provider investigation before retry. This version deliberately does not expose a “force successful” button or release the obligation. Preserve evidence and use a reviewed repair command/provider process.

## Duplicate capture

- Confirm distinct external capture IDs, not a duplicate webhook. The same ID is deduplicated automatically.
- A different excess capture is recorded in provider receivable/customer refund liability and emits `payment.exception`. No second kitchen order is created.
- Finance requests the excess return from the reconciliation screen, and a different finance approver reviews it in refunds. The worker returns it to the original payment without debiting owner earnings. Never delete the capture or issue a second blind charge.

## Kitchen / kiosk disconnection

- Screens show reconnecting; polling refreshes authorized snapshots. A stale action fails its version guard. Do not assume a click succeeded without server confirmation.
- Recover kiosk pending payment using its saved checkout; do not silently reset unresolved payment.
- Kiosk idle reset clears ordinary carts after warning, but preserves an unresolved payment. Use dedicated browser profiles and managed kiosk mode.

## Item unavailable / station closure

- Hold the item or station with a reason. New quotes/checkout attempts reject it; already accepted payment leases remain commitments.
- Staff raises an incident for an unfulfillable paid order. Billing submits a quantity-specific cancellation/refund; operations follows the approval rules.
- Archive is blocked while live work exists. Reassign unstarted units within the outlet, resolve or cancel before closing the station.

## Wrong completion / pickup dispute

- Cooking completed is not pickup ready. Serving verifies the prepared units before marking ready.
- For mistakes, a manager creates linked no-charge rework. Do not rewrite original preparation or pickup history.
- Customer supplies the receipt pickup code. A manager override requires a documented reason. Post-handover credits use REFUND_ONLY.

## Cash close

- Each cashier opens a shift on an active POS. Record float and any drawer movement with reason.
- Confirm physical cash sale/refund once. Close with counted cash; inspect variance against captured cash and movements.
- Closed shifts remain historical. Do not edit recorded sales to make the drawer match.

## Settlement / owner dispute

- Compare immutable sale/refund allocations and commission versions. Owner statements show only that outlet.
- Draft payout, separate finance approval, then bank evidence. Approval reserves funds; it is not a transfer.
- Later refunds reduce the next balance, including a negative balance when an owner was already paid. Do not rewrite paid statements.

## Reconciliation mismatch

- Import statements using stable external IDs. Conflicting same-ID evidence is rejected.
- Check payment/refund reference, amount, currency and timing. A mismatch cannot be dismissed by inventing successful money movement.
- Fee/settlement classifications post linked balanced journals. Two-person review and external evidence should be part of finance operation until a dedicated adjustment approval screen is added.

## Printer failure

- Electronic order remains authoritative. Browser print can be retried; a linked print-job request indicates reprint intent.
- Physical paper completion is not known to the server without a hardware spooler adapter. Do not create another sale to get another receipt.

## Restore / suspected compromise

- Preserve source data, revoke affected users/sessions and rotate compromised credentials through controlled procedures.
- `npm run backup` creates a local dump. `npm run test:restore` restores into a new isolated database, checks order count and ledger balance, then removes only the drill database.
- For a real recovery, restore to a new instance, verify tenant access/ledger/token constraints, replay provider/inbox reconciliation and only then switch traffic. Keep ENCRYPTION_KEY available from the secret manager.
- Managed point-in-time recovery and external audit export must be tested in the deployment environment. Do not treat a local dump test as proof of a five-minute production RPO.
