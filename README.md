# DealForge

Modern affiliate product discovery platform. DealForge aggregates products from affiliate partners and routes shoppers to retailers — it does not sell inventory directly.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS v4
- **Prisma** + SQLite for local development
- **PostgreSQL (Neon)** for hosted production
- **JWT sessions** with bcrypt password hashing
- **Modular affiliate connectors**
- **Redis-ready cache** with in-memory + DB fallback
- **Background maintenance scripts** for trending scores, flash expiry, cache purge and price alerts

## Quick start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

## Production deployment

DealForge is a full Next.js application with API routes and a database. The no-recurring-hosting-cost deployment target is **Koyeb Free Web Service + the existing DealForge Neon PostgreSQL database**.

See `DEPLOYMENT-KOYEB.md` for the release checklist.

### Koyeb

Create a Web Service from the GitHub repository and use:

- Runtime: Node.js 20
- Region: Washington, D.C.
- Instance: Free
- Build command: `npm run build`
- Run command: `npm run start`
- Port: `3000`
- Route: `/`

Set production configuration in Koyeb environment variables / Secrets:

```text
DATABASE_URL=<existing DealForge Neon pooled PostgreSQL connection string>
AUTH_SECRET=<long random secret at least 32 characters>
AMAZON_ASSOCIATE_TAG=titanfieldos-20
AMAZON_PARTNER_TAG=titanfieldos-20
NEXT_PUBLIC_APP_URL=https://www.deal-forge.sale
NEXT_PUBLIC_APP_NAME=DealForge
```

Do **not** configure seed/admin passwords in Koyeb. The existing Neon production database is already initialized and production deploys must not reseed it.

### Neon database

The existing DealForge Neon project is the production database. Do not create or seed a replacement database during hosting migration.

### Custom domain

Attach `www.deal-forge.sale` to the Koyeb App and create the CNAME value Koyeb provides at the DNS provider. Configure `deal-forge.sale` to redirect to `https://www.deal-forge.sale` if the DNS provider cannot point the apex domain directly to Koyeb.

### Background maintenance

The free Koyeb allocation is used for the web service. Do not create a second paid Worker service just to run DealForge maintenance. Catalog validation and maintenance can be run separately until a scheduled no-cost workflow is configured.

## Catalog maintenance

Catalog link validation is intentionally **non-destructive by default**. A listing must be classified dead twice before it is reported as confirmed dead, and ambiguous/blocked/error results are left untouched.

| Command | Purpose |
|---|---|
| `npm run catalog:validate` | Report Amazon listing health without deleting products |
| `npm run catalog:validate -- --dry-run` | Explicit report-only scan |
| `npm run catalog:validate -- --delete-confirmed` | Delete only listings independently confirmed dead twice |
| `npm run catalog:repair-images` | Repair product images |
| `npm run catalog:sync-images` | Synchronize product images |
| `npm run catalog:refresh-prices` | Refresh catalog prices |
| `npm run worker -- --once` | Run a single background maintenance pass |

## Homepage de-duplication

Featured, Trending, Flash Deals, New Arrivals, and the infinite All Deals feed share a page-level product-ID exclusion set. A product already rendered in a promoted section is not rendered again by another promoted section or by the infinite feed during the same page visit.

## Pages

- `/` — Home
- `/categories`, `/categories/[slug]`
- `/product/[slug]` — Product detail + retailer CTA
- `/search` — Search, filters and sort
- `/deals` — Flash deals
- `/dashboard/*` — Wishlist, saved searches, recent, alerts, settings
- `/admin` — Admin tools

## Affiliate disclosure

The footer states that product links may be affiliate links and that DealForge may earn commissions from qualifying purchases.
