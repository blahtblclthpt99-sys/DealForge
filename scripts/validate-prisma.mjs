import { execFileSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function validate(schema, databaseUrl) {
  execFileSync(npx, ["prisma", "validate", `--schema=${schema}`], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

validate("prisma/schema.prisma", "file:./prisma-validate.db");
validate(
  "prisma/schema.postgres.prisma",
  process.env.DATABASE_URL?.startsWith("postgres")
    ? process.env.DATABASE_URL
    : "postgresql://dealforge:dealforge@localhost:5432/dealforge_validate?schema=public",
);
