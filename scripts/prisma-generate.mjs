import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL || "";
const usePostgres =
  process.env.VERCEL === "1" ||
  url.startsWith("postgres://") ||
  url.startsWith("postgresql://");

const schema = usePostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
console.log(`[prisma-generate] schema=${schema}`);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["prisma", "generate", `--schema=${schema}`], { stdio: "inherit" });
