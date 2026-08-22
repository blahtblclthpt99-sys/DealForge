const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const db = path.join(root, "prisma", "product-engine-test.db");
for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  try { fs.rmSync(db + suffix, { force: true }); } catch {}
}

const env = {
  ...process.env,
  DATABASE_URL: "file:./product-engine-test.db",
  NODE_ENV: "test",
  AUTH_SECRET: "product-engine-test-secret-not-production",
  AMAZON_ASSOCIATE_TAG: "dealforge-test-20",
};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args) {
  execFileSync(npx, args, { cwd: root, env, stdio: "inherit" });
}

run(["prisma", "generate", "--schema=prisma/schema.prisma"]);
run(["prisma", "db", "push", "--schema=prisma/schema.prisma", "--skip-generate"]);
run(["tsx", "--test", "tests/product-engine.test.ts"]);

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  try { fs.rmSync(db + suffix, { force: true }); } catch {}
}
