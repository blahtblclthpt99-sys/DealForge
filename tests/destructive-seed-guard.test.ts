import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const guard = "scripts/guard-destructive-seed.mjs";
const confirmation = "I_UNDERSTAND_DATA_WILL_BE_DELETED";

function runGuard(env: Record<string, string>) {
  return spawnSync(process.execPath, [guard], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("destructive seed guard allows ordinary local SQLite development", () => {
  const result = runGuard({ DATABASE_URL: "file:./dev.db", NODE_ENV: "development" });
  assert.equal(result.status, 0, result.stderr);
});

test("destructive seed guard blocks production and non-local databases by default", () => {
  const productionLocal = runGuard({ DATABASE_URL: "file:./prod.db", NODE_ENV: "production" });
  assert.notEqual(productionLocal.status, 0);
  assert.match(productionLocal.stderr, /Refusing destructive seed/);

  const postgres = runGuard({
    DATABASE_URL: "postgresql://example.invalid/dealforge",
    NODE_ENV: "development",
  });
  assert.notEqual(postgres.status, 0);
  assert.match(postgres.stderr, /Refusing destructive seed/);
});

test("protected destructive seeds require explicit non-default admin credentials", () => {
  const postgresDefault = runGuard({
    DATABASE_URL: "postgresql://example.invalid/dealforge",
    ALLOW_DESTRUCTIVE_SEED: confirmation,
    ADMIN_EMAIL: "admin@dealforge.com",
    ADMIN_PASSWORD: "AdminDealForge2026!",
  });
  assert.notEqual(postgresDefault.status, 0);
  assert.match(postgresDefault.stderr, /ADMIN_PASSWORD/);

  const productionSqliteDefault = runGuard({
    DATABASE_URL: "file:./prod.db",
    NODE_ENV: "production",
    ALLOW_DESTRUCTIVE_SEED: confirmation,
    ADMIN_EMAIL: "admin@dealforge.com",
    ADMIN_PASSWORD: "ChangeMeAdmin123!",
  });
  assert.notEqual(productionSqliteDefault.status, 0);
  assert.match(productionSqliteDefault.stderr, /ADMIN_PASSWORD/);

  const approved = runGuard({
    DATABASE_URL: "postgresql://example.invalid/dealforge",
    ALLOW_DESTRUCTIVE_SEED: confirmation,
    ADMIN_EMAIL: "admin@dealforge.com",
    ADMIN_PASSWORD: "unique-admin-bootstrap-password-2026",
  });
  assert.equal(approved.status, 0, approved.stderr);
});

test("all package scripts that invoke destructive seed pass through the guard", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  for (const scriptName of ["db:seed", "db:setup", "db:setup:postgres"]) {
    assert.match(pkg.scripts[scriptName], /guard-destructive-seed\.mjs/);
  }
  assert.match(pkg.scripts["catalog:discover"], /npm run db:seed/);
  assert.match(pkg.scripts["catalog:refresh"], /npm run db:seed/);
});

test("known packaged auth placeholder is rejected in production", async () => {
  const source = await readFile("src/lib/auth-secret.ts", "utf8");
  assert.match(source, /CHANGE-ME-generate-a-long-random-string/);
});
