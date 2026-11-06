# Shopify ↔ DealForge Integration Contract

Status: implementation plan / launch gate (not yet connected to the Shopify Admin API)

## System ownership

DealForge remains the merchant-of-record application and the canonical customer storefront at https://deal-forge.sale. Shopify is a connected supplier/catalog system for products sourced through Shopify Collective. The Shopify Online Store theme is not the canonical storefront and must not be published as a competing storefront.

| Concern | System of record |
|---|---|
| Customer-facing catalog and merchandising | DealForge |
| Product source identity, supplier identity and Shopify variant IDs | Shopify / Shopify Collective |
| Supplier cost, shipping, tax, fees and landed cost snapshot | DealForge SupplierOffer |
| Current supplier availability | Shopify supplier/Collective evidence, timestamped in DealForge |
| Retail price and customer checkout | DealForge |
| Payment status, refunds and financial reconciliation | Verified Stripe events + DealForge ledger |
| Procurement execution | Manual review only until payment and source integrity certification passes |
| Customer orders and support | DealForge |

## Non-negotiable invariants

1. Never copy Shopify inventory quantities into DealForge as if they were owned stock. Store supplier availability evidence, observation time, and confidence separately.
2. Never enable a product for checkout unless a current, eligible SupplierOffer passes source verification, resale permission, price freshness, inventory confidence, currency, and landed-cost validation.
3. A supplier cost is not a retail price. Preserve the supplier's current cost separately from the DealForge selling price.
4. Every paid OrderItem must retain an immutable supplier/source snapshot. Later supplier edits must not rewrite the economics of an existing order.
5. Shopify product/variant IDs and supplier identifiers must be stored as external identifiers with idempotent upserts. Repeated syncs must not create duplicate DealForge products or offers.
6. Inventory/price sync failures, stale observations, missing credentials, rate limits, and supplier product removals must fail closed. Do not guess stock or cost.
7. Shopify must not process DealForge customer checkout or become the financial source of truth. DealForge Checkout and verified Stripe webhooks remain authoritative.
8. Do not initiate supplier purchases automatically. Procurement remains manual-only until the complete Stripe Phase 2.5 certification and procurement controls pass.

## Integration sequence

### A. Credentials and access

Create a Shopify custom app for the connected shop and grant only the required read scopes initially: read_products, read_inventory, and the minimum supplier/Collective access Shopify exposes for this merchant. Keep the Admin API token server-side. Configure:

- SHOPIFY_STORE_DOMAIN=7cvgka-gi.myshopify.com
- SHOPIFY_ADMIN_ACCESS_TOKEN (server-only secret; never commit)
- SHOPIFY_API_VERSION (pin to a supported stable Admin API version)

Do not use a storefront token for Admin API calls. Do not place any Shopify secret in a NEXT_PUBLIC_* variable.

### B. Read-only source adapter

Implement a server-only Shopify Admin GraphQL adapter with:
- bounded request timeout and response size;
- API-version pinning;
- explicit GraphQL errors handling;
- cursor pagination with a hard per-run cap;
- 429 / transient 5xx backoff and rate-limit telemetry;
- strict runtime validation of product, variant, inventory and currency fields;
- no credential or customer PII logging.

### C. Idempotent catalog ingestion

Map each Shopify product and variant to stable external keys. Upsert DealForge Product and SupplierOffer records; do not use product title as an identity key. Preserve:
- Shopify shop domain, product GID and variant GID;
- supplier name/ID and source URL;
- SKU and variant options;
- supplier item cost and currency;
- separately observed shipping, tax, fees and handling;
- stock/availability observation and timestamp;
- source verification and resale permission evidence.

Unknown cost components remain unknown; they must not silently become zero. A product may be staged for review, but must not become commerce-enabled by import alone.

### D. Pricing and margin gate

Calculate landed cost in integer minor units. Apply DealForge's pricing policy only after the complete cost basis is present. Calculate contribution margin after payment processing, tax treatment, shipping subsidy, expected refunds/returns and support/fulfillment costs. Reject negative or below-policy margins. Store the formula/version and all source observations with the offer.

### E. Inventory and offer freshness

Schedule a bounded reconciliation job. Treat webhooks as hints that trigger a fresh Admin API read, not as sole proof of current availability. Use idempotent event handling and persist observation timestamps. If Shopify cannot prove a current quantity/availability observation, set the offer to unavailable/unknown and prevent checkout.

### F. Launch gates

- Shopify custom app credentials configured and validated.
- Read-only product and inventory sync tested against the connected shop.
- Repeated sync idempotency test passes.
- Supplier cost and resale authorization evidence validated.
- Every published DealForge product has a current eligible offer and complete landed cost.
- DealForge checkout uses server-authoritative prices and immutable source snapshots.
- Stripe test payment, webhook replay, refund and reconciliation certification pass.
- Domain, policies, shipping/returns, mobile and end-to-end checkout QA pass.

## Current verified blockers (2026-11-06)

- Connected Shopify store currently contains 17 products; every product returned in the current catalog scan has zero inventory. These quantities must not be overwritten or treated as available.
- Several existing active listings are Shopify Collective imports, but DealForge has not yet been shown a validated Admin API credential or a successful source/inventory sync into its SupplierOffer ledger.
- DealForge README explicitly keeps commerce disabled by default until Stripe Phase 2.5 certification passes.
- The connected Shopify store has a separate unpublished DealForge premium theme while its existing Helio theme remains live. Do not publish the Shopify theme as part of this integration.

## Completion definition

The bridge is complete only when the read-only Shopify adapter, idempotent ingestion, verified cost/inventory snapshots, automated tests, production secrets, and operational sync monitoring are all in place. Catalog presence alone is not proof of launch readiness.

## Implemented read-only bridge (branch: feature/shopify-dealforge-catalog-bridge)

The branch now includes:
- `src/lib/shopify-admin.ts`: server-only Admin GraphQL client, pinned API version, 12-second request timeout, strict response validation, rate-limit handling, and bounded page sizes.
- `src/app/api/admin/shopify/catalog/route.ts`: owner-gated, no-store catalog preview endpoint at `GET /api/admin/shopify/catalog`, with cursor pagination.
- `.env.example`: server-side Shopify configuration placeholders.

Required production/local variables:
- `SHOPIFY_STORE_DOMAIN=7cvgka-gi.myshopify.com`
- `SHOPIFY_ADMIN_ACCESS_TOKEN` (secret)
- `SHOPIFY_API_VERSION=2026-10`
- `PRODUCT_ENGINE_OWNER_EMAIL`

Initial Admin API access needs read-only product and inventory scopes. The connector query was validated against the connected Shopify Admin GraphQL schema and executed successfully against the live shop. The first product page returned product/variant data; the sample variants all showed inventory quantity 0 and unit cost null. This is a hard stop for commercial publication, not a reason to infer supplier stock or cost.

The endpoint is deliberately preview-only. It does not write to Product, Supplier, SupplierOffer, or inventory ledgers. That separation is intentional until supplier resale permission and landed-cost completeness are proven. The Shopify response includes per-product variant pagination metadata so products with more than 50 variants are explicitly flagged rather than silently treated as complete.

Before production use, configure the Shopify custom app token as a server secret and set the owner email. The endpoint will return 503 until its required server-side credentials are configured.

### Live catalog verification detail (2026-11-06)

A full read-only Admin GraphQL scan returned 17 products and 125 variants across 15 vendor names. All 125 variants reported inventory quantity 0; none exposed a supplier unit cost. A direct inventory-level read for the COR Surf packing-cube product confirmed its Collective location ("COR Surf via Shopify Collective") has available, committed, and on-hand quantities all at 0. One product, "Heavyweight Hoodie P2016", has more than 50 variants; the bridge flags this condition rather than silently claiming the variant set is complete.

These facts mean the current catalog is not yet eligible for automatic DealForge publication. The listed Shopify prices are not verified supplier acquisition costs, and current zero inventory cannot be treated as available stock.


## Public storefront verification gate (2026-11-06)

The public catalog is now deliberately stricter than the internal certification catalog:

- Internal certification IDs and `dealforge-test` retailer records are always excluded from public product queries and detail pages.
- Affiliate listings require current price and metadata provenance; Amazon records must use the authorized Amazon source marker.
- Direct listings require commerce to be enabled, positive server-owned selling price and landed cost, and a fresh price verification timestamp. The existing checkout and live inventory-binding gates still run before a direct purchase is offered.
- Catalog/category/brand cache keys were versioned so previously cached certification fixtures cannot reappear after deployment.
- When no eligible product remains, the homepage displays a transparent verified-inventory preparation state rather than test merchandise.

Production database audit: 21,382 Product rows were present. Of the 21,373 non-certification rows not marked out of stock, zero had a current verified price source, zero had verified metadata, and zero were commerce-enabled. The connected Shopify catalog separately returned 17 products / 125 variants; all variants had zero observed inventory and null supplier unit cost. These records are not commercially eligible and must not be promoted by a bulk import.
