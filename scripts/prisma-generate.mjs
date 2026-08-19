/**
 * Pick SQLite for local development and PostgreSQL for hosted production.
 * Koyeb exposes KOYEB_APP_ID during builds; a PostgreSQL DATABASE_URL also forces Postgres.
 */
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL || "";
const usePostgres =
  Boolean(process.env.KOYEB_APP_ID) ||
  url.startsWith("postgres://") ||
  url.startsWith("postgresql://");

const schema = usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
console.log(`[prisma-generate] schema=${schema}`);
execFileSync("npx", ["prisma", "generate", `--schema=${schema}`], { stdio: "inherit" });
