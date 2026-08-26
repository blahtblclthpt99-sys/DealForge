import { createHash } from "node:crypto";
import { parseProcurementSupplierSnapshot } from "./procurement-intents";

export type ProcurementSourceLockV1 = {
  version: 1;
  sourceLockKey: string;
  persistedSupplierId: string;
  persistedOfferId: string;
  persistedOfferKey: string;
  supplierName: string;
  sourceClass: string;
  sourceUrl: string | null;
  currency: string;
  expectedUnitCostCents: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function deriveProcurementSourceLock(
  supplierSnapshot: string,
  expectedUnitCostCents: number | null,
  currency: string,
): ProcurementSourceLockV1 | null {
  const snapshot = parseProcurementSupplierSnapshot(supplierSnapshot);
  const normalizedCurrency = currency.trim().toLowerCase();
  if (
    !snapshot ||
    !/^[a-z]{3}$/.test(normalizedCurrency) ||
    snapshot.currency.toLowerCase() !== normalizedCurrency ||
    !Number.isSafeInteger(expectedUnitCostCents) ||
    !expectedUnitCostCents ||
    expectedUnitCostCents <= 0 ||
    snapshot.costBreakdown.landedCostCents !== expectedUnitCostCents
  ) return null;

  const canonical = JSON.stringify({
    version: 1,
    persistedSupplierId: snapshot.persistedSupplierId,
    persistedOfferId: snapshot.persistedOfferId,
    persistedOfferKey: snapshot.persistedOfferKey,
    sourceClass: snapshot.sourceClass,
    sourceUrl: snapshot.sourceUrl,
    currency: normalizedCurrency,
    expectedUnitCostCents,
  });

  return {
    version: 1,
    sourceLockKey: `proc_source_lock_v1_${sha256(canonical)}`,
    persistedSupplierId: snapshot.persistedSupplierId,
    persistedOfferId: snapshot.persistedOfferId,
    persistedOfferKey: snapshot.persistedOfferKey,
    supplierName: snapshot.supplierName,
    sourceClass: snapshot.sourceClass,
    sourceUrl: snapshot.sourceUrl,
    currency: normalizedCurrency,
    expectedUnitCostCents,
  };
}

export function procurementSourceConfirmationMatches(
  lock: ProcurementSourceLockV1 | null,
  confirmation: { supplierOfferId: string; sourceLockKey: string },
) {
  if (!lock) return false;
  return (
    confirmation.supplierOfferId.trim() === lock.persistedOfferId &&
    confirmation.sourceLockKey.trim().toLowerCase() === lock.sourceLockKey
  );
}
