import { spawnSync } from "node:child_process";
import { getPrisma } from "../src/lib/db";
import {
  planProductionMigrationReconciliation,
  verifyCurrentProductionMigrationState,
  type MigrationFingerprint,
  type MigrationLedgerEntry,
} from "../src/lib/production-migration-plan";

const PRODUCTION_GUARD = "dealforge-neon-production";

const FINGERPRINT_SQL = String.raw`
WITH checks(migration_name, satisfied) AS (
  VALUES
  ('20260822000000_dealforge_baseline',
    to_regclass('public."User"') IS NOT NULL
    AND to_regclass('public."Category"') IS NOT NULL
    AND to_regclass('public."Product"') IS NOT NULL
    AND to_regclass('public."AffiliateProvider"') IS NOT NULL
    AND to_regclass('public."ClickEvent"') IS NOT NULL
    AND to_regclass('public."ImportJob"') IS NOT NULL
    AND to_regclass('public."ApiUsageLog"') IS NOT NULL
    AND to_regclass('public."SystemLog"') IS NOT NULL
    AND to_regclass('public."CacheEntry"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='Product_slug_key')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Product_categoryId_fkey')),
  ('20260822102000_product_engine_safe_intake',
    to_regclass('public."ProductCandidate"') IS NOT NULL
    AND to_regclass('public."ProductEngineWorkerState"') IS NOT NULL
    AND to_regclass('public."ProductEngineConfig"') IS NOT NULL
    AND to_regclass('public."ProductEngineAudit"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='priceSource')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='priceVerifiedAt')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='metadataSource')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='metadataVerifiedAt')),
  ('20260822152000_stripe_financial_gate',
    to_regclass('public."Order"') IS NOT NULL
    AND to_regclass('public."OrderItem"') IS NOT NULL
    AND to_regclass('public."Payment"') IS NOT NULL
    AND to_regclass('public."PaymentEvent"') IS NOT NULL
    AND to_regclass('public."Refund"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='commerceEnabled')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='Order_money_nonnegative_chk')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OrderItem_money_positive_chk')),
  ('20260824232000_supplier_persistence_v1',
    to_regclass('public."Supplier"') IS NOT NULL
    AND to_regclass('public."SupplierOffer"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SupplierOffer_supplierId_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SupplierOffer_productId_fkey')),
  ('20260825015500_order_item_supplier_snapshot',
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='OrderItem' AND column_name='supplierSnapshot')),
  ('20260825021000_procurement_intent_journal_v1',
    to_regclass('public."ProcurementIntent"') IS NOT NULL
    AND to_regclass('public."ProcurementEvent"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ProcurementIntent_orderId_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ProcurementIntent_orderItemId_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ProcurementEvent_procurementIntentId_fkey')),
  ('20260825053000_refund_financial_reconciliation_v1',
    to_regclass('public."RefundFinancialEvent"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='RefundFinancialEvent_refundId_fkey')),
  ('20260825120000_customer_savings_fund_phase_a',
    to_regclass('public."SavingsFundEntry"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SavingsFundEntry_phase_a_dry_run')
    AND EXISTS (SELECT 1 FROM pg_rules WHERE schemaname='public' AND tablename='SavingsFundEntry' AND rulename='SavingsFundEntry_prevent_update_rule')
    AND EXISTS (SELECT 1 FROM pg_rules WHERE schemaname='public' AND tablename='SavingsFundEntry' AND rulename='SavingsFundEntry_prevent_delete_rule')),
  ('20260825143000_production_schema_reconciliation_v1',
    to_regclass('public."ProductCandidate"') IS NOT NULL
    AND to_regclass('public."SupplierOffer"') IS NOT NULL
    AND to_regclass('public."ProcurementIntent"') IS NOT NULL
    AND to_regclass('public."RefundFinancialEvent"') IS NOT NULL
    AND to_regclass('public."SavingsFundEntry"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='Product_commerceEnabled_idx')),
  ('20260825151500_inventory_observation_journal_v1',
    to_regclass('public."InventoryObservation"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='InventoryObservation_idempotencyKey_key')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InventoryObservation_supplierOfferId_fkey')),
  ('20260825162500_inventory_recheck_control_plane_v1',
    to_regclass('public."InventoryRecheckJob"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='InventoryRecheckJob_idempotencyKey_key')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InventoryRecheckJob_supplierOfferId_fkey')),
  ('20260825163500_inventory_adapter_nonce_v1',
    to_regclass('public."InventoryAdapterNonce"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='InventoryAdapterNonce_nonceHash_key')),
  ('20260825165000_inventory_adapter_rate_windows_v1',
    to_regclass('public."InventoryAdapterRateWindow"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='InventoryAdapterRateWindow_scope_window_key')),
  ('20260825233000_order_destination_v1',
    to_regclass('public."OrderDestination"') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='OrderDestination_orderId_key')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='OrderDestination_orderId_fkey')
    AND EXISTS (SELECT 1 FROM information_schema.triggers WHERE event_object_schema='public' AND event_object_table='OrderDestination' AND trigger_name='OrderDestination_prevent_update'))
)
SELECT migration_name AS "migrationName", satisfied
FROM checks
ORDER BY migration_name;
`;

function assertProductionTarget() {
  if (process.env.PRODUCTION_SCHEMA_MIGRATION !== PRODUCTION_GUARD) {
    throw new Error("Production schema migration guard is not enabled");
  }

  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!hostname.endsWith(".neon.tech")) {
    throw new Error(`Refusing production migration reconciliation for non-Neon host: ${hostname}`);
  }
}

async function readFingerprints(): Promise<MigrationFingerprint[]> {
  const prisma = getPrisma();
  return prisma.$queryRawUnsafe<MigrationFingerprint[]>(FINGERPRINT_SQL);
}

async function readLedger(): Promise<MigrationLedgerEntry[]> {
  const prisma = getPrisma();
  const table = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS exists`,
  );
  if (!table[0]?.exists) return [];

  return prisma.$queryRawUnsafe<MigrationLedgerEntry[]>(`
    SELECT
      migration_name AS "migrationName",
      (finished_at IS NOT NULL) AS finished,
      (rolled_back_at IS NOT NULL) AS "rolledBack"
    FROM "_prisma_migrations"
    ORDER BY started_at, migration_name
  `);
}

function resolveMigrationAsApplied(migrationName: string) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    executable,
    [
      "prisma",
      "migrate",
      "resolve",
      "--applied",
      migrationName,
      "--schema=prisma/schema.postgres.prisma",
    ],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`prisma migrate resolve failed for ${migrationName}`);
  }
}

async function prepare() {
  const fingerprints = await readFingerprints();
  const ledger = await readLedger();
  const plan = planProductionMigrationReconciliation({ fingerprints, ledger });

  console.log(
    `Legacy migration reconciliation: ${plan.resolveAsApplied.length} ledger entries to resolve, ${plan.pendingAfterResolve.length} migrations left for migrate deploy.`,
  );
  console.log(`Pending after resolve: ${plan.pendingAfterResolve.join(", ") || "none"}`);

  await getPrisma().$disconnect();

  for (const migrationName of plan.resolveAsApplied) {
    console.log(`Marking verified legacy migration as applied: ${migrationName}`);
    resolveMigrationAsApplied(migrationName);
  }
}

async function verify() {
  const fingerprints = await readFingerprints();
  const ledger = await readLedger();
  verifyCurrentProductionMigrationState({ fingerprints, ledger });
  console.log("Production Prisma migration ledger and schema fingerprints are current.");
  await getPrisma().$disconnect();
}

async function main() {
  assertProductionTarget();
  const mode = process.argv[2];
  if (mode === "--prepare") {
    await prepare();
    return;
  }
  if (mode === "--verify") {
    await verify();
    return;
  }
  throw new Error("Usage: tsx scripts/reconcile-production-migrations.ts --prepare|--verify");
}

main().catch(async (error) => {
  try {
    await getPrisma().$disconnect();
  } catch {
    // Preserve the original migration failure.
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
