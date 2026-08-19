# DealForge

Modern affiliate product discovery platform. DealForge aggregates products from affiliate partners and routes shoppers to retailers — it does not sell inventory directly.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS v4
- **Prisma** + SQLite for local development
- **PostgreSQL (Neon)** for hosted production
- **JWT sessions** with bcrypt password hashing
- **Modular affiliate connectors**
- **Redis-ready cache** with in-memory + DB fallback
- **Background worker** for trending scores, flash expiry, cache purge, price alerts

## Quick start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

Open `http://localhost:3000`.

## Production deployment

DealForge is a full Next.js application with API routes and a database. Production hosting is configured for **Netlify + Neon PostgreSQL**.

### Netlify

Connect the GitHub repository to Netlify. Netlify supports modern Next.js features including App Router, SSR, route handlers, middleware, and image optimization.

Build settings are checked into `netlify.toml`:

- Build command: `npm run build:netlify`
- Publish directory: `.next`
- Node: 20

Set these environment variables in Netlify:

```text
DATABASE_URL=<Neon pooled PostgreSQL connection string>
AUTH_SECRET=<long random secret>
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD=<strong admin password>
AMAZON_ASSOCIATE_TAG=titanfieldos-20
AMAZON_PARTNER_TAG=titanfieldos-20
NEXT_PUBLIC_APP_URL=https://deal-forge.sale
NEXT_PUBLIC_APP_NAME=DealForge
```

### Neon database

Create a Neon PostgreSQL database and use its pooled connection string as `DATABASE_URL`.

Initialize the production schema once:

```bash
DATABASE_URL="postgresql://..." npm run db:setup:postgres
```

Then deploy DealForge from Netlify.

### Custom domain

Attach `deal-forge.sale` to the Netlify site and update the domain DNS to the records Netlify provides. Keep `NEXT_PUBLIC_APP_URL=https://deal-forge.sale`.

## Catalog maintenance

| Command | Purpose |
|---|---|
| `npm run catalog:validate` | Check Amazon listings and remove confirmed dead products |
| `npm run catalog:repair-images` | Repair product images |
| `npm run catalog:sync-images` | Synchronize product images |
| `npm run catalog:refresh-prices` | Refresh catalog prices |
| `npm run worker -- --once` | Run a single background maintenance pass |

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
