FROM node:24-alpine AS deps
WORKDIR /app
ENV PRISMA_DATABASE_PROVIDER=postgresql
COPY package.json package-lock.json ./
# package.json postinstall runs scripts/prisma-generate.mjs, so copy the
# generator and both schemas before npm ci instead of relying on files that
# are only present in the later full-source copy.
COPY scripts/prisma-generate.mjs ./scripts/prisma-generate.mjs
COPY prisma/schema.prisma prisma/schema.postgres.prisma ./prisma/
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_DATABASE_PROVIDER=postgresql
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
