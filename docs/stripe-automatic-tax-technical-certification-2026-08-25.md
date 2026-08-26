# DealForge Stripe Automatic Tax — Technical Certification

Date: 2026-08-25 (America/Chicago)

## Certified production revision

`f9dd3a823865bb7295f86dfd6d0d4a115d2c8f30`

## Certification workflow

GitHub Actions workflow: `Stripe Automatic Tax E2E Certification`

Run: `32918393723`, attempt 2

Result: **PASS**

The workflow verified the exact production revision before performing the transaction.

## What was proven

A fresh guarded DealForge certification transaction completed through the production Cloudflare runtime using Stripe test mode and the certification-only catalog.

The certification proved:

- Stripe Checkout Session creation with `automatic_tax.enabled=true`.
- Explicit physical-goods tax classification for the certification product.
- Tax-exclusive pricing behavior.
- Hosted Checkout completion at the Oklahoma certification destination.
- A non-zero Stripe Automatic Tax calculation under an active Oklahoma **sandbox** registration.
- Processing of the signed `checkout.session.completed` webhook.
- Stripe merchandise subtotal exactly matched `Order.subtotalCents`.
- Stripe tax exactly matched `Order.taxCents`.
- Stripe shipping exactly matched `Order.shippingCents`.
- Stripe discount remained zero.
- Stripe grand total exactly matched `Order.totalCents`.
- The succeeded DealForge payment ledger amount exactly matched the authoritative order total.
- Order arithmetic reconciled as subtotal + shipping + tax = total.
- Procurement intents remained `manual_only`.

The successful workflow posted commit status context:

`stripe-automatic-tax-e2e-certification`

with description:

`Stripe automatic tax -> signed Checkout webhook -> exact order/payment tax reconciliation verified`

## Important scope boundary

This is a **technical integration certification**, not a legal tax-compliance certification.

The Oklahoma registration used for this E2E test is a Stripe sandbox/test-mode registration. Sandbox registrations exist only to exercise Stripe Tax calculation behavior and do not establish, represent, or modify DealForge's live legal registrations.

Therefore this certification does **not** authorize changing `TAX_COMPLIANCE_CERTIFIED` to true.

Before live customer commerce can rely on Stripe Tax, DealForge must separately establish and verify:

1. the jurisdictions in which DealForge has a legal obligation to collect tax;
2. any required tax permits/registrations in those jurisdictions;
3. matching live-mode Stripe Tax registrations;
4. product-specific tax codes where the generic tangible-goods classification is insufficient;
5. origin/head-office and other tax settings used by live Stripe Tax;
6. a live-mode readiness review that confirms no sandbox registration or test credential is being treated as legal evidence.

## Locks retained

This certification does not remove the existing release safeguards:

- `TAX_COMPLIANCE_CERTIFIED=false` remains required until the separate compliance gate is satisfied.
- Broad catalog commerce remains locked.
- Production commerce remains constrained to the guarded certification environment until separately released.
- Procurement remains `manual_only`.

## Evidence integrity

The passing run generated a dedicated tax certification artifact and completed only after the direct Stripe Session values and the persisted DealForge order/payment records reconciled. The prior attempt correctly failed when Stripe returned zero tax because no sandbox registration was active; no verifier condition was weakened to obtain the passing result.
