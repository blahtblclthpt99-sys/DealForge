/**
 * Pick SQLite schema locally, Postgres schema on Vercel / when DATABASE_URL is Postgres.
 */
const { execSync } = require("child_process");

const url = process.env.DATABASE_URL || "";
const usePostgres =
  process.env.VERCEL === "1" ||
  url.startsWith("postgres://") ||
  url.startsWith("postgresql://");

const schema = usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
console.log(`[prisma-generate] schema=${schema}`);
execSync(`npx prisma generate --schema=${schema}`, { stdio: "inherit" });
