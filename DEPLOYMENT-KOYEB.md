# DealForge — Koyeb + Neon deployment

This branch migrates DealForge to a normal Node.js/Next.js web service on Koyeb while preserving the existing DealForge Neon PostgreSQL database.

## Source of truth

- Repository: `blahtblclthpt99-sys/DealForge`
- Release branch: `migration/koyeb-neon`
- Production database: existing Neon DealForge project
- Production URL target: `https://www.deal-forge.sale`

Do not create or seed a replacement production database during this hosting migration.

## Koyeb service

Create one Web Service from GitHub using:

- Branch: `migration/koyeb-neon`
- Runtime: Node.js 20
- Region: Washington, D.C.
- Instance: Free
- Build command: `npm run build`
- Run command: `npm run start`
- Port: `3000`
- Route: `/`

## Required environment variables

Set these as Koyeb environment variables or Secrets:

```text
DATABASE_URL=<existing Neon pooled PostgreSQL connection string>
AUTH_SECRET=<long random production secret>
ADMIN_EMAIL=<production admin email>
ADMIN_PASSWORD=<strong production admin password>
AMAZON_ASSOCIATE_TAG=titanfieldos-20
AMAZON_PARTNER_TAG=titanfieldos-20
NEXT_PUBLIC_APP_URL=https://www.deal-forge.sale
NEXT_PUBLIC_APP_NAME=DealForge
```

Never commit the real `DATABASE_URL`, authentication secret, or production admin password to GitHub.

## Pre-deployment quality gate

GitHub Actions runs `.github/workflows/quality-gate.yml` on migration-branch pushes and pull requests. The release is not ready if dependency installation, linting, or the production build fails.

## Catalog safety gate

`npm run catalog:validate` is report-only. It does not delete products. A listing must be independently classified dead twice before it is reported as confirmed dead. Blocked or error responses are left untouched.

Deletion is a separate explicit maintenance action:

```bash
npm run catalog:validate -- --delete-confirmed
```

Do not run the destructive form as part of the web-service startup or deployment command.

## Live release checks

Before merging the migration PR, verify the generated Koyeb URL for:

1. `/` loads products from Neon.
2. Featured, Trending, Flash Deals and New Arrivals do not repeat the same product IDs.
3. Infinite All Deals loading does not re-render products already shown on the page.
4. `/categories` and at least two category pages load.
5. `/deals` loads without server errors.
6. `/search` returns catalog results.
7. `/register` and `/login` load and reject invalid input safely.
8. At least three `/product/[slug]` pages load.
9. At least three `/go/[productId]` routes redirect to the expected retailer domain.
10. Unauthenticated dashboard access is handled correctly.
11. Unauthenticated/non-admin access cannot use admin functionality.
12. No production page tells the user to configure Vercel or Netlify.
13. No hard-coded personal email/greeting is present in the public UI.

## Domain cutover

Only after the generated Koyeb URL passes the release checks:

1. Add `www.deal-forge.sale` to the Koyeb App.
2. Add the DNS value Koyeb provides.
3. Redirect `deal-forge.sale` to `https://www.deal-forge.sale` if necessary.
4. Re-run the live release checks on the custom domain.
5. Merge the migration PR only after the custom-domain deployment passes.
