import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CURRENT_PRODUCTION_MIGRATIONS,
  LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT,
  planProductionMigrationReconciliation,
  verifyCurrentProductionMigrationState,
} from "../src/lib/production-migration-plan";

const EXPECTED_MISSING_BEFORE_REPAIR = [
  "20260825151500_inventory_observation_journal_v1",
  "20260825162500_inventory_recheck_control_plane_v1",
  "20260825165000_inventory_adapter_rate_windows_v1",
  "20260825233000_order_destination_v1",
];

function auditedLegacyFingerprints() {
  const legacy = new Set<string>(LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT);
  return CURRENT_PRODUCTION_MIGRATIONS.map((migrationName) => ({
    migrationName,
    satisfied: legacy.has(migrationName),
  }));
}

test("legacy production reconciliation resolves only schema already proven present", () => {
  const plan = planProductionMigrationReconciliation({
    fingerprints: auditedLegacyFingerprints(),
    ledger: [],
  });

  assert.deepEqual(
    plan.resolveAsApplied,
    [...LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT],
  );
  assert.deepEqual(plan.pendingAfterResolve, EXPECTED_MISSING_BEFORE_REPAIR);
  assert.equal(plan.resolveAsApplied.includes("20260825233000_order_destination_v1"), false);
});

test("legacy production reconciliation fails closed on a missing historical fingerprint", () => {
  const fingerprints = auditedLegacyFingerprints();
  fingerprints[0] = { ...fingerprints[0], satisfied: false };

  assert.throws(
    () =>
      planProductionMigrationReconciliation({
        fingerprints,
        ledger: [],
      }),
    /Legacy production schema fingerprint mismatch/,
  );
});

test("legacy production reconciliation fails closed on an incomplete Prisma ledger", () => {
  assert.throws(
    () =>
      planProductionMigrationReconciliation({
        fingerprints: auditedLegacyFingerprints(),
        ledger: [
          {
            migrationName: "20260825151500_inventory_observation_journal_v1",
            finished: false,
            rolledBack: false,
          },
        ],
      }),
    /incomplete migrations/,
  );
});

test("current production verification requires every migration and schema fingerprint", () => {
  const fingerprints = CURRENT_PRODUCTION_MIGRATIONS.map((migrationName) => ({
    migrationName,
    satisfied: true,
  }));
  const ledger = CURRENT_PRODUCTION_MIGRATIONS.map((migrationName) => ({
    migrationName,
    finished: true,
    rolledBack: false,
  }));

  assert.equal(
    verifyCurrentProductionMigrationState({ fingerprints, ledger }),
    true,
  );
});

test("Cloudflare publish is gated on migration reconciliation and shipping reruns on contract changes", () => {
  const root = process.cwd();
  const deployWorkflow = fs.readFileSync(
    path.join(root, ".github/workflows/cloudflare-production-deploy.yml"),
    "utf8",
  );
  const shippingWorkflow = fs.readFileSync(
    path.join(root, ".github/workflows/shipping-e2e-certification.yml"),
    "utf8",
  );
  const reconciler = fs.readFileSync(
    path.join(root, "scripts/reconcile-production-migrations.ts"),
    "utf8",
  );

  const migrationGate = deployWorkflow.indexOf(
    "Reconcile and deploy production database migrations",
  );
  const migrateDeploy = deployWorkflow.indexOf(
    "prisma migrate deploy --schema=prisma/schema.postgres.prisma",
  );
  const workerBuild = deployWorkflow.indexOf("Build Cloudflare Worker");
  const workerPublish = deployWorkflow.indexOf("npx wrangler deploy --secrets-file");

  assert.ok(migrationGate >= 0);
  assert.ok(migrateDeploy > migrationGate);
  assert.ok(workerBuild > migrateDeploy);
  assert.ok(workerPublish > workerBuild);
  assert.match(deployWorkflow, /context=cloudflare-db-migrations/);
  assert.match(reconciler, /PRODUCTION_SCHEMA_MIGRATION/);
  assert.match(reconciler, /\.neon\.tech/);

  assert.match(
    shippingWorkflow,
    /\.github\/workflows\/cloudflare-production-deploy\.yml/,
  );
  assert.match(shippingWorkflow, /prisma\/migrations\/\*\*/);
  assert.match(shippingWorkflow, /scripts\/reconcile-production-migrations\.ts/);
  assert.match(shippingWorkflow, /src\/lib\/production-migration-plan\.ts/);
});
