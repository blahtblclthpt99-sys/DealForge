/**
 * Pick SQLite for local development and PostgreSQL for hosted production.
 * Netlify sets NETLIFY=true during builds; a PostgreSQL DATABASE_URL also forces Postgres.
 */
const { execSync } = require("child_process");

const url = process.env.DATABASE_URL || "";
const usePostgres =
  process.env.NETLIFY === "true" ||
  process.env.CONTEXT === "production" ||
  url.startsWith("postgres://") ||
  url.startsWith("postgresql://");

const schema = usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
console.log(`[prisma-generate] schema=${schema}`);
execSync(`npx prisma generate --schema=${schema}`, { stdio: "inherit" });
