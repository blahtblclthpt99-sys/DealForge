# DealForge — Koyeb + Neon deployment

Production target:

- Application host: Koyeb free Web Service
- Database: existing Neon PostgreSQL project
- Source: GitHub `blahtblclthpt99-sys/DealForge`
- Production domain: `www.deal-forge.sale` with the apex domain redirected to `www`

## Koyeb service

Create a Web Service from GitHub and select the production branch.

Recommended settings:

- Runtime: Node.js
- Region: Washington, D.C. (`was`)
- Instance: Free
- Build command: `npm run build`
- Run command: `npm run start`
- Port: `3000`
- Route: `/`

DealForge uses Koyeb's `PORT` environment variable through Next.js `next start`.

## Required environment variables

Store sensitive values using Koyeb Secrets where possible.

- `DATABASE_URL` — existing Neon pooled PostgreSQL connection string
- `AUTH_SECRET` — long random production secret
- `NEXT_PUBLIC_APP_URL=https://www.deal-forge.sale`
- `NEXT_PUBLIC_APP_NAME=DealForge`
- `AMAZON_ASSOCIATE_TAG=titanfieldos-20`
- `AMAZON_PARTNER_TAG=titanfieldos-20`

Optional provider/API credentials should also be stored as Koyeb Secrets.

## Domain

Koyeb supports custom domains and automatic TLS. Add `www.deal-forge.sale` to the Koyeb app and create the CNAME Koyeb provides at the DNS provider.

For the apex `deal-forge.sale`, configure an HTTP redirect to `https://www.deal-forge.sale` unless the DNS provider supports apex CNAME flattening compatible with Koyeb.

## Release gate

Do not merge the hosting migration until all of these pass on the generated Koyeb URL:

- `/`
- `/categories`
- `/deals`
- `/search`
- `/register`
- `/login`
- representative `/product/[slug]`
- representative `/go/[productId]`
- authentication and session persistence
- wishlist/dashboard authorization
- admin authorization
- Neon database reads/writes
- affiliate redirects

After live verification, attach the custom domain and repeat the route audit.
