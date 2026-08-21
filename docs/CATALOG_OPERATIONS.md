# DealForge Catalog Operations

This document is the release policy for product data, affiliate destinations, pricing, and retailer expansion.

## Product price trust model

DealForge separates internal historical/catalog data from shopper-facing retailer pricing.

- **Current price**: received from an approved retailer/API source within its freshness window. For Amazon, the production source is Amazon Creators API and the current freshness window is 24 hours.
- **Legacy/recorded Amazon amount**: retained internally for migration, anomaly detection, and audit only. It is not a shopper-facing Amazon price until refreshed through the approved source.
- **Unavailable/unverified price**: no current trusted price can be published. The storefront sends the shopper to the retailer to check the current price and availability.
- Discounts, strike-through list prices, savings percentages, price sorting/filtering, and price-alert decisions must use current trusted prices only.
- A failed refresh must never advance a product's price timestamp or make stale data appear fresh.
- Amazon HTML scraping is not an approved source of production price truth.
- Amazon price and availability content must follow the current Associates/Creators API caching, timestamp, disclosure, and display requirements before it is published.

## Amazon

Affiliate tag: `titanfieldos-20`.

Required for live price synchronization:

- `AMAZON_CREATORS_CREDENTIAL_ID`
- `AMAZON_CREATORS_CREDENTIAL_SECRET`
- `AMAZON_CREATORS_CREDENTIAL_VERSION`

Only a successful Creators API response may write `priceSource=amazon-creators-api` and `priceCheckedAt`.

Until Creators API is authorized and returning a fresh offer, Amazon product cards and detail pages must show a retailer price-check state instead of the legacy stored dollar amount.

## Affiliate destination safety

- Every public outbound purchase click goes through `/go/[productId]`.
- The route validates HTTPS, credentials, ports, and retailer-specific destination hosts.
- Unknown retailers do not fall back to Amazon.
- Unsupported or unsafe destinations fail closed to the DealForge product page.
- Products marked `storefrontBlocked=true` cannot be discovered publicly or monetized through `/go`.
- Do not ingest a retailer's products until the retailer has a real affiliate/deep-link configuration or an explicit non-affiliate product strategy has been approved.
- A provider is not considered revenue-ready merely because its database row is enabled; runtime tracked-link credentials must also be present.

## Dead-link policy

`npm run catalog:links` is report-only by default.

Amazon states are treated separately:

- `ok`: listing exists.
- `unavailable`: listing exists but may be out of stock or unavailable; keep it.
- `blocked`: Amazon blocked/redirected the check; ambiguous, keep it.
- `error`: network/parser failure; ambiguous, keep it.
- `dead`: two independent Amazon product URL forms both produced an explicit missing-page result.

Deletion is never automatic. `--delete-confirmed` must be supplied explicitly after reviewing the report.

## Catalog health commands

Run the full non-destructive structural health pass:

```bash
npm run catalog:health
```

It runs:

```bash
npm run catalog:verify-affiliate
npm run catalog:verify-prices
npm run catalog:verify-structure
```

Run external dead-link checking separately because it is network-intensive:

```bash
npm run catalog:links -- --limit 200
```

Run current Amazon price refresh only after Creators API credentials are configured:

```bash
npm run catalog:refresh-prices -- --limit 50
```

## Retailer expansion status

The connector registry currently recognizes:

- Amazon
- eBay
- AliExpress
- Walmart
- Etsy
- CJ Affiliate
- Impact
- Awin
- Rakuten Advertising
- ShareASale

Recognition is not the same as monetization readiness. Stubs or disabled providers must not be treated as commission-producing integrations.

Recommended rollout order:

1. Amazon — current storefront source; finish Creators API authorization for live prices.
2. eBay — code supports EPN tracked links; verify runtime EPN credentials before importing inventory.
3. Walmart — enable only after Walmart/Impact affiliate approval and tracked-link configuration.
4. AliExpress — enable only after Portals tracking credentials are verified at runtime.
5. Etsy / merchant programs through Awin, CJ, Impact, Rakuten, or ShareASale — add one merchant at a time with explicit host and tracking validation.

Best Buy has an official affiliate/creator program administered through Impact and is a strong later candidate. Target and other merchants may also be evaluated, but each merchant must have its current affiliate relationship and deep-link mechanism verified before being added.

## Release gates

Before a catalog or affiliate release:

1. `npm run lint`
2. `npm run build`
3. `npm run catalog:health` against the intended database
4. Cloudflare/OpenNext candidate build
5. Live Worker route smoke
6. Affiliate redirect check including retailer host and tracking identifier
7. Price presentation check: stale Amazon amounts must remain hidden; current prices require trusted freshness
8. Runtime provider-readiness check
9. Custom-domain smoke before declaring production complete
