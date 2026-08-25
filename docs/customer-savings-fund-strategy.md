# DealForge Customer Savings Fund Strategy

## Purpose

Create a sustainable mechanism that reinvests a controlled share of **realized DealForge profit** into lower future customer prices without weakening supplier-payment, refund, chargeback, tax, or operating reserves.

The goal is a compounding customer-value loop:

**SELL SAFELY → REALIZE PROFIT → FUND SAVINGS POOL → LOWER SELECTED CART PRICES → IMPROVE CONVERSION/AOV → REALIZE MORE PROFIT → REPEAT**

This is an internal pricing reinvestment program, not an investment-security product and not a promise of future discounts.

## Core Rule

Only **realized contribution profit from settled orders** may fund customer price reductions.

Never use:

- gross revenue,
- pending Stripe proceeds,
- customer money needed for fulfillment,
- estimated future profit,
- tax liabilities,
- refund/chargeback reserves,
- supplier-payment funds,
- borrowed money.

## Recommended Starting Allocation

Start with **10% of eligible realized contribution profit** flowing into a Customer Savings Fund.

Example:

- settled order revenue after refunds: $100
- supplier/payment/fulfillment/reserve costs: $80
- realized contribution profit: $20
- 10% Savings Fund allocation: $2
- retained operating profit: $18

The allocation should be calculated after financial reconciliation, not at checkout.

## Three-Stage Long-Term Plan

### Stage 1 — Prove the loop

Savings Fund allocation: **5–10%** of realized contribution profit.

Requirements before discounts are released:

- positive trailing-30-day realized contribution profit,
- refund and chargeback reserves fully funded,
- no unresolved supplier payment deficit,
- no finance reconciliation anomaly,
- minimum operating cash buffer met.

Use the fund only on low-risk products with:

- high inventory confidence,
- recent supplier-price verification,
- low return/refund rate,
- low source volatility,
- positive historical contribution margin.

### Stage 2 — Scale customer savings

Savings Fund allocation: **10–15%** when DealForge has at least 90 days of stable positive unit economics.

Add product-level targeting:

- proven repeat-purchase products,
- cart add-ons that improve total bundle economics,
- products with high conversion but price sensitivity,
- products with negotiated supplier savings,
- categories with low support and return cost.

At this stage DealForge can favor bundles because a profitable primary product can support a lower-margin add-on while the **whole order remains safely profitable**.

### Stage 3 — Compounding value moat

Savings Fund allocation: up to **20–25%** only after durable profitability, mature reconciliation, and adequate operating reserves.

Use supplier rebates, negotiated volume discounts, logistics savings, lower payment costs, and realized operating efficiencies to increase the amount returned to customers without reducing business resilience.

The long-term objective is not simply to cut margin. It is to make DealForge structurally cheaper as its own costs improve.

## Per-Order Subsidy Guardrail

A savings-fund price reduction should be capped by all of these limits:

1. available Savings Fund balance,
2. **5% of the cart subtotal** during Stage 1,
3. **25% of that cart's pre-subsidy contribution profit** during Stage 1,
4. a hard post-discount contribution-profit floor,
5. current checkout exposure limits.

Recommended formula:

`fundedSavings = min(availableFundAllocation, cartSubtotal * 5%, preSubsidyContributionProfit * 25%)`

Example:

- cart subtotal before fund discount: $40.00
- pre-subsidy contribution profit: $7.00
- 5% cart cap: $2.00
- 25% profit cap: $1.75
- available savings allocation: $5.00
- maximum fund reduction: **$1.75**
- customer pays: **$38.25**
- order still retains approximately **$5.25** contribution profit before any later reconciliation adjustments.

## Important Pricing Principle

The Customer Savings Fund must never be used to create a fake comparison price.

DealForge should distinguish:

- **Published DealForge price** — the storefront ceiling,
- **Cart-safe price** — the recalculated minimum-safe price already produced by the cart engine,
- **Savings Fund reduction** — an additional, explicitly funded price reduction,
- **Final customer price** — the amount sent to checkout.

Only genuine reductions should be presented as savings.

## Bundle Strategy

The existing `Find cheap add-ons` cart step is a natural place to apply future Savings Fund logic.

Recommended bundle ranking should eventually consider:

- same subcategory,
- same brand,
- semantic compatibility,
- add-on price as a percentage of the main cart,
- add-on return rate,
- supplier confidence,
- total order contribution profit,
- expected fulfillment complexity,
- available Savings Fund budget.

A bundle should be optimized on **whole-order economics**, not on each line independently.

This creates opportunities such as:

- $35 main item + $6 accessory,
- accessory receives a $1 Savings Fund reduction,
- customer perceives a stronger bundle value,
- total order remains above the DealForge order-profit floor.

## Fund Ledger

Before activating automatic subsidies, add an auditable ledger rather than maintaining a single mutable balance.

Suggested records:

### SavingsFundEntry

- id
- type: `accrual | allocation | release | reversal | adjustment`
- orderId / refundId where applicable
- amountCents
- currency
- sourceProfitCents
- policyVersion
- createdAt
- metadata

The current balance should always be derived from immutable credits and debits.

## Reconciliation Rules

Accrual should occur only after an order's economics are sufficiently settled.

If an order later receives a refund, chargeback, supplier credit, or cost correction:

- reverse or adjust the related Savings Fund accrual,
- never silently change historical ledger entries,
- preserve an audit trail.

## Circuit Breakers

Automatically stop new Savings Fund releases when any of these conditions occur:

- trailing-30-day realized contribution profit is zero or negative,
- operating cash reserve falls below its configured floor,
- refund or chargeback rate breaches policy,
- financial reconciliation is stale or unhealthy,
- supplier-cost volatility exceeds policy,
- Stripe/payment reconciliation has unresolved material differences,
- commerce kill switch is active.

Accrual may also be paused when finance data is incomplete.

## Recommended Rollout

### Phase A — Measure only

Track what a 10% fund would have accrued and what eligible carts could have received. Do not change customer prices yet.

### Phase B — Owner-controlled release

Allow an administrator to enable a bounded daily or weekly Savings Fund budget. Keep the per-cart caps above.

### Phase C — Automatic release

Automate only after measured results show:

- positive incremental conversion,
- healthy contribution profit after discounts,
- stable refund/chargeback behavior,
- no reserve impairment.

### Phase D — Adaptive allocation

Let DealForge increase or decrease the reinvestment percentage within owner-approved limits based on trailing realized economics.

The automation may recommend a percentage but must never exceed the configured owner maximum.

## Recommended Initial Defaults

- realized-profit allocation: **10%**
- per-cart subtotal cap: **5%**
- pre-subsidy contribution-profit cap: **25%**
- minimum release: **$0.50**
- maximum Stage-1 release per order: **$5.00**
- minimum trailing-profit window: **30 days**
- automatic stop when trailing realized contribution profit <= 0
- automatic stop when financial reconciliation is unhealthy

These should remain configurable policy values, not hard-coded business assumptions.

## Success Metrics

Monitor:

- realized contribution profit after funded savings,
- fund accrual vs. release,
- conversion lift,
- average order value,
- add-on attach rate,
- repeat purchase rate,
- refund/return rate,
- chargeback rate,
- cost per acquired customer,
- profit dollars per visitor,
- customer savings dollars returned,
- percentage of orders receiving funded savings.

The primary optimization target should be **long-run realized profit dollars plus customer value**, not gross sales or discount percentage alone.

## Recommended Next Engineering Phase

Do not connect this fund directly to production checkout yet.

Next build:

1. immutable Savings Fund ledger,
2. reconciliation-backed profit accrual calculation,
3. dry-run savings allocator,
4. admin dashboard showing hypothetical fund balance and eligible discounts,
5. tests proving the allocator cannot spend customer/supplier/reserve money,
6. only then add an owner-controlled production activation flag.
