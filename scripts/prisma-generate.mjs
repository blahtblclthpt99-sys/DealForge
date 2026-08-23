import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL || "";
const explicitProvider = (process.env.PRISMA_DATABASE_PROVIDER || "").trim().toLowerCase();

const forcePostgres = explicitProvider === "postgres" || explicitProvider === "postgresql";
const forceSqlite = explicitProvider === "sqlite";

const isCloudflareBuild =
  process.env.CLOUDFLARE_WORKERS === "1" ||
  Boolean(process.env.WORKERS_CI_COMMIT_SHA) ||
  Boolean(process.env.CF_PAGES);

const usePostgres =
  !forceSqlite &&
  (forcePostgres ||
    process.env.VERCEL === "1" ||
    isCloudflareBuild ||
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://"));

const schema = usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
console.log(`[prisma-generate] schema=${schema}`);

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["prisma", "generate", `--schema=${schema}`], { stdio: "inherit" });
