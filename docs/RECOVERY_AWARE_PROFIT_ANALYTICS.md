# DealForge Recovery-Aware Profit Analytics

## Purpose

DealForge must not call a number profit when required financial inputs are missing or estimated. This layer adds a read-only order contribution view that incorporates customer refunds, actual supplier cost, supplier recovery, accepted unrecovered loss, collected tax, and authoritative payment-processing fees.

## Accounting treatment

For an order:

`net customer receipts = gross customer receipts - succeeded customer refunds`

`net supplier cost = actual supplier cost - supplier recovery received`

Accepted unrecovered loss is **not** subtracted a second time. It is an explicit acknowledgement that a portion of supplier cost was not recovered. The expense already exists inside net supplier cost.

When all required evidence is complete:

`certified order contribution = net customer receipts - net supplier cost - known tax liability - authoritative payment-processing cost`

This is an order-level contribution metric, not GAAP net income. It intentionally excludes business overhead and other costs that DealForge does not yet record authoritatively, including marketing CAC, support overhead, and unrecorded chargeback losses.

## Certification requirements

`certifiedOrderContributionCents` is null unless all of the following are true:

- order subtotal + shipping + tax equals order total
- refund ledger is currency-consistent and does not exceed the order total
- exactly one succeeded payment matches the order currency and total
- every order line has recorded actual supplier cost
- every post-purchase recovery case is valid and closed
- aggregate recovery/loss accounting cannot exceed one procurement intent's actual supplier cost
- no customer refund remains pending
- taxable refunded orders have authoritative refund-tax allocation; DealForge does not infer it from a lump-sum refund
- every succeeded payment has an authoritative processing-fee record

## Payment-processing cost

DealForge accepts a recorded processing fee only when Payment.meta contains a non-negative `processingFeeCents` with provenance of either:

- `stripe_balance_transaction`
- `stripe_balance_transaction_webhook`

A configured Stripe rate, percentage calculation, manual guess, or historical fee schedule is not authoritative enough to certify realized contribution.

No code in this phase calls Stripe or a supplier. Fee ingestion/reconciliation is a separate financial-control gate.

## Recovery controls

Supplier credits reduce supplier cost only when recorded in the existing recovery ledger. Multiple refund/recovery cases on the same procurement intent are checked again in aggregate so two individually valid cases cannot collectively claim more recovery/loss accounting than the supplier cost actually incurred.

## Operational output

The admin commerce order feed now exposes:

- gross and net customer receipts
- succeeded and pending customer refunds
- known actual and projected supplier cost
- supplier recovery received
- net supplier cost
- accepted unrecovered loss
- remaining recovery exposure
- open recovery cases
- known authoritative payment-processing fees
- contribution before tax/payment fees
- certified order contribution when complete
- explicit finalization reasons when incomplete

Automatic supplier purchasing and automatic recovery remain disabled.
