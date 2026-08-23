# Phase 3 Manual Sourcing and Fulfillment

DealForge keeps financial state and fulfillment state separate.

## Financial authority

`Order.status` remains owned by the Stripe payment/refund lifecycle. The sourcing and fulfillment controls do not write that field and do not call Stripe APIs.

An order can enter the actionable sourcing queue only when:

- its financial status is exactly `paid`;
- `paidAt` and the Stripe PaymentIntent reference are present;
- the DealForge Payment ledger contains the matching succeeded payment for the full order amount and currency.

Partially refunded or fully refunded orders are not actionable sourcing work.

## Fulfillment journal

The first Phase 3 fulfillment control plane uses the append-only `SystemLog` journal with source `order-fulfillment:<orderId>`. This avoids coupling shipping state to Stripe-owned financial state and avoids a production schema migration in this slice.

The guarded progression is:

`awaiting_sourcing -> sourcing -> supplier_ordered -> shipped -> delivered`

An order may be placed on `hold` before shipment and explicitly returned to `sourcing`.

Invalid state jumps fail closed. Each mutation repeats the current financial and fulfillment-state checks inside the database transaction and takes an optimistic lock on the current Order revision before writing the fulfillment event.

## Supplier purchasing

Supplier purchasing remains manual.

`MARK_SUPPLIER_ORDERED` requires one supplier purchase record for every DealForge OrderItem, including the external supplier order/reference and actual cost for that line. The server checks complete, non-duplicated line coverage.

The actual supplier total is compared with the landed-cost estimate captured on the customer order:

- cost above the estimate requires explicit cost-variance acknowledgement;
- supplier cost at or above the customer order total requires an additional explicit loss-risk acknowledgement;
- no API automatically places a supplier order;
- every fulfillment event records `automaticSupplierPurchasingEnabled: false`.

## Shipping and delivery

Shipping requires a carrier and tracking number before the order can move from `supplier_ordered` to `shipped`. Delivery is a separate explicit transition.

This slice records operational truth for the owner. Customer notifications, carrier API verification, and automated procurement remain separate future gates.
