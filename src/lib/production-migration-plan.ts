export const CURRENT_PRODUCTION_MIGRATIONS = [
  "20260822000000_dealforge_baseline",
  "20260822102000_product_engine_safe_intake",
  "20260822152000_stripe_financial_gate",
  "20260824232000_supplier_persistence_v1",
  "20260825015500_order_item_supplier_snapshot",
  "20260825021000_procurement_intent_journal_v1",
  "20260825053000_refund_financial_reconciliation_v1",
  "20260825120000_customer_savings_fund_phase_a",
  "20260825143000_production_schema_reconciliation_v1",
  "20260825151500_inventory_observation_journal_v1",
  "20260825162500_inventory_recheck_control_plane_v1",
  "20260825163500_inventory_adapter_nonce_v1",
  "20260825165000_inventory_adapter_rate_windows_v1",
  "20260825233000_order_destination_v1",
] as const;

/**
 * These migrations are already materially represented in the legacy DealForge
 * production database even though that database predates Prisma's migration
 * ledger. They may be marked applied only after their live schema fingerprints
 * are re-verified immediately before reconciliation.
 *
 * InventoryObservation, InventoryRecheckJob, InventoryAdapterRateWindow and
 * OrderDestination are intentionally excluded because the 2026-08-25 Neon
 * production audit proved those objects were absent.
 */
export const LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT = [
  "20260822000000_dealforge_baseline",
  "20260822102000_product_engine_safe_intake",
  "20260822152000_stripe_financial_gate",
  "20260824232000_supplier_persistence_v1",
  "20260825015500_order_item_supplier_snapshot",
  "20260825021000_procurement_intent_journal_v1",
  "20260825053000_refund_financial_reconciliation_v1",
  "20260825120000_customer_savings_fund_phase_a",
  "20260825143000_production_schema_reconciliation_v1",
  "20260825163500_inventory_adapter_nonce_v1",
] as const;

export type MigrationFingerprint = {
  migrationName: string;
  satisfied: boolean;
};

export type MigrationLedgerEntry = {
  migrationName: string;
  finished: boolean;
  rolledBack: boolean;
};

function asSet(values: readonly string[]) {
  return new Set(values);
}

export function planProductionMigrationReconciliation(input: {
  fingerprints: readonly MigrationFingerprint[];
  ledger: readonly MigrationLedgerEntry[];
}) {
  const fingerprintByName = new Map(
    input.fingerprints.map((entry) => [entry.migrationName, entry.satisfied]),
  );

  const failedOrIncomplete = input.ledger.filter(
    (entry) => !entry.finished && !entry.rolledBack,
  );
  if (failedOrIncomplete.length > 0) {
    throw new Error(
      `Production migration ledger contains incomplete migrations: ${failedOrIncomplete
        .map((entry) => entry.migrationName)
        .join(", ")}`,
    );
  }

  const rolledBackCurrent = input.ledger.filter(
    (entry) =>
      entry.rolledBack &&
      CURRENT_PRODUCTION_MIGRATIONS.includes(
        entry.migrationName as (typeof CURRENT_PRODUCTION_MIGRATIONS)[number],
      ),
  );
  if (rolledBackCurrent.length > 0) {
    throw new Error(
      `Production migration ledger contains rolled-back current migrations: ${rolledBackCurrent
        .map((entry) => entry.migrationName)
        .join(", ")}`,
    );
  }

  const missingLegacyFingerprints = LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT.filter(
    (migrationName) => fingerprintByName.get(migrationName) !== true,
  );
  if (missingLegacyFingerprints.length > 0) {
    throw new Error(
      `Legacy production schema fingerprint mismatch: ${missingLegacyFingerprints.join(", ")}`,
    );
  }

  const applied = asSet(
    input.ledger
      .filter((entry) => entry.finished && !entry.rolledBack)
      .map((entry) => entry.migrationName),
  );

  const resolveAsApplied = LEGACY_PRODUCTION_MIGRATIONS_ALREADY_PRESENT.filter(
    (migrationName) => !applied.has(migrationName),
  );
  const resolved = asSet(resolveAsApplied);

  const pendingAfterResolve = CURRENT_PRODUCTION_MIGRATIONS.filter(
    (migrationName) => !applied.has(migrationName) && !resolved.has(migrationName),
  );

  return {
    resolveAsApplied,
    pendingAfterResolve,
  };
}

export function verifyCurrentProductionMigrationState(input: {
  fingerprints: readonly MigrationFingerprint[];
  ledger: readonly MigrationLedgerEntry[];
}) {
  const fingerprintByName = new Map(
    input.fingerprints.map((entry) => [entry.migrationName, entry.satisfied]),
  );
  const applied = asSet(
    input.ledger
      .filter((entry) => entry.finished && !entry.rolledBack)
      .map((entry) => entry.migrationName),
  );

  const missingFingerprints = CURRENT_PRODUCTION_MIGRATIONS.filter(
    (migrationName) => fingerprintByName.get(migrationName) !== true,
  );
  const missingLedgerEntries = CURRENT_PRODUCTION_MIGRATIONS.filter(
    (migrationName) => !applied.has(migrationName),
  );
  const incomplete = input.ledger.filter(
    (entry) => !entry.finished && !entry.rolledBack,
  );

  if (
    missingFingerprints.length > 0 ||
    missingLedgerEntries.length > 0 ||
    incomplete.length > 0
  ) {
    throw new Error(
      [
        missingFingerprints.length
          ? `missing schema fingerprints: ${missingFingerprints.join(", ")}`
          : null,
        missingLedgerEntries.length
          ? `missing migration ledger entries: ${missingLedgerEntries.join(", ")}`
          : null,
        incomplete.length
          ? `incomplete migration ledger rows: ${incomplete
              .map((entry) => entry.migrationName)
              .join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  return true;
}
