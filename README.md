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
| `npm run build`    | Production build                     |
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
- Use PostgreSQL: change Prisma `provider` to `postgresql` and set `DATABASE_URL`
- Set `REDIS_URL` for shared cache / rate-limit counters
- Put images behind a CDN; seed currently uses inline SVG placeholders for offline demos
- Run `npm run worker` as a separate process (or cron)
- Configure Amazon PA-API credentials before live catalog sync

## Deploy to the web (website launcher)

DealForge is a full Next.js app (API routes + database). It cannot run on plain static file hosting alone.

### Quick — Vercel (recommended)

```bash
npm i -g vercel   # once
vercel login
vercel --prod
```

Set env vars in the Vercel dashboard from `.env.production.example`. Use **PostgreSQL** for `DATABASE_URL` (Neon, Supabase, or Vercel Postgres). After connecting the DB, run `npm run db:setup` once locally against that URL, or use `vercel env pull` + `db:setup`.

Point your domain (IONOS, etc.): add a **CNAME** for `www` to your Vercel project.

### Upload zip — self-hosted Node (VPS / Node hosting)

Same workflow as TitanOS `ionos:package`, but runs a Node server instead of static files:

```bash
npm run website:package
```

Upload **`release/DealForge-Web.zip`** to your server, unzip, edit `.env`, then run `START.bat` or `node server.js`. Full instructions are inside the zip (`UPLOAD-INSTRUCTIONS.txt`).

The zip includes the seeded SQLite catalog (~15k products) so the live site works immediately.

| Command | Purpose |
|---------|---------|
| `npm run website:package` | Build + zip for Node self-host |
| `npm run deploy:vercel` | Deploy to Vercel production |
