# DealForge Phase 3 — Profit Observability

This slice adds owner-only, read-only realized contribution analytics from existing financial and fulfillment ledgers.

## Accounting label

The dashboard intentionally reports **realized contribution**, not net profit.

For an eligible order:

`realized contribution = customer order total - succeeded refunds - actual recorded supplier cost`

The result currently excludes payment-processing fees, taxes owed by DealForge, chargebacks not represented as succeeded refunds, labor, support cost, insurance, software, advertising, and other overhead. Until those actual costs are incorporated, the UI and API must not call this metric net profit.

## Data authority

An order is eligible for a realized contribution rollup only when:

- the order has a verified `paidAt` value;
- the order has a Stripe PaymentIntent ID;
- a local succeeded Payment row matches that PaymentIntent, order amount, and currency;
- currency is USD;
- a manual `MARK_SUPPLIER_ORDERED` fulfillment journal entry contains a positive actual supplier cost.

Succeeded Refund rows reduce customer revenue. A fully refunded order with incurred supplier cost can therefore produce negative realized contribution.

## Reporting period

The 30/90/365-day selector is based on `Order.paidAt`. For selected orders, the calculation uses the current succeeded-refund ledger. The API is bounded to the most recent 250 qualifying orders in the selected period.

## Supplier cost

- Estimated supplier cost comes from quantity-aware `OrderItem.landedCostCents` snapshots captured at customer Checkout.
- Actual supplier cost comes only from the owner-confirmed `MARK_SUPPLIER_ORDERED` journal entry.
- Supplier references are not returned by the profitability API.
- Cost variance is actual supplier cost minus estimated supplier cost.

## Privacy and mutation boundaries

The profitability endpoint is owner-only, private/no-store, and read-only. It does not return customer email, supplier order references, or owner/admin IDs. It does not call Stripe and does not write orders, refunds, products, or logs.

## Release safeguards

Commerce-core tests cover malformed money, payment certification, actual-cost requirements, refunds, positive/negative contribution, cost variance, rollups, and supplier-cost extraction. A source-level safety test prevents the profitability endpoint from acquiring financial/catalog mutation behavior or Stripe API calls.
