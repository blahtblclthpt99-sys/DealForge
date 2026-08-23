# DealForge

Modern affiliate product discovery platform. DealForge aggregates products from affiliate partners and routes shoppers to retailers — it does not sell inventory directly.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS v4
- **Prisma** + SQLite (swap `DATABASE_URL` to PostgreSQL for production)
- **JWT sessions** with bcrypt password hashing
- **Modular affiliate connectors** (Amazon Associates live; Walmart, eBay, CJ, Impact, Awin, Rakuten, ShareASale, Etsy stubbed)
- **Redis-ready cache** with in-memory + DB fallback
- **Background worker** for trending scores, flash expiry, cache purge, price alerts

## Quick start

```bash
npm install
cp .env.example .env
npm run db:setup       # prisma db push + seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo accounts

| Role  | Email               | Password           |
|-------|---------------------|--------------------|
| User  | demo@dealforge.com   | DemoUser123!       |
| Admin | admin@dealforge.com  | AdminDealForge2026! |

## Amazon Associates

Tracking ID: **`titanfieldos-20`**

Every Amazon purchase link is generated as:

```
https://www.amazon.com/dp/{ASIN}?tag=titanfieldos-20
```

See `src/lib/affiliate/providers/amazon.ts`. To enable Product Advertising API imports, set `AMAZON_ACCESS_KEY` and `AMAZON_SECRET_KEY` in `.env`.

## Adding another affiliate network

1. Implement `AffiliateConnector` in `src/lib/affiliate/providers/`
2. Register it in `src/lib/affiliate/registry.ts`
3. Enable the row in Admin → Affiliate networks (or seed `AffiliateProvider`)

## Scripts

| Command            | Description                          |
|--------------------|--------------------------------------|
| `npm run dev`      | Local development                    |
| `npm run build`    | Provider-neutral production build    |
| `npm run gate:ship` | Lint, typecheck, tests, Prisma validation, production build |
| `npm run db:setup` | Push schema + seed                   |
| `npm run worker`   | Background jobs (loop every 5 min)   |
| `npm run worker -- --once` | Single worker pass            |

## Pages

- `/` — Home (hero, featured, trending, flash, categories, infinite feed)
- `/categories`, `/categories/[slug]`
- `/product/[slug]` — SEO product detail + buy CTA
- `/search` — Live search + filters + sort
- `/deals` — Flash deals
- `/dashboard/*` — Wishlist, saved searches, recent, alerts, settings
- `/admin` — Affiliate stats, imports, logs, cache, users, products

## Affiliate disclosure

A required disclosure appears in the site footer stating DealForge may earn commissions from qualifying purchases through affiliate links.

## Production notes

- Set a strong `AUTH_SECRET`
- Use PostgreSQL and set `DATABASE_URL`
- Set `REDIS_URL` for shared cache / rate-limit counters when external caching is enabled
- Put images behind a CDN when appropriate
- Run `npm run worker` as a separate process or scheduled worker
- Keep production commerce disabled until the Stripe payment lifecycle certification gate passes

## Deploy to the web

DealForge is a full Next.js application with API routes and database-backed functionality. It requires a Node-compatible runtime or another hosting environment that fully supports the application's server-side Next.js features; plain static hosting is not sufficient.

### Provider-neutral production flow

```bash
npm ci
npm run gate:ship
npm run db:setup:postgres
npm run start
```

Set production environment variables from `.env.production.example`, including a PostgreSQL `DATABASE_URL`, authentication secrets, and Stripe configuration. Route `deal-forge.sale` to the chosen production runtime only after health checks and the transaction certification gate pass.

### Packaged self-hosted Node deployment

```bash
npm run website:package
```

Upload **`release/DealForge-Web.zip`** to a compatible Node host, unzip it, configure `.env`, and start the packaged server according to `UPLOAD-INSTRUCTIONS.txt`.

| Command | Purpose |
|---------|---------|
| `npm run build` | Build the production application without provider-specific tooling |
| `npm run gate:ship` | Run the release quality gate before deployment |
| `npm run website:package` | Build and package DealForge for Node self-hosting |
