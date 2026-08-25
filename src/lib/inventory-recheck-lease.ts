import { prisma } from "./db";
import {
  DIRECT_RESALE_SOURCE_CLASSES,
  DIRECT_RESALE_SOURCE_MAX_AGE_MS,
  SOURCE_VERIFICATION_FUTURE_TOLERANCE_MS,
} from "./source-policy";

export type BoundInventoryRecheckLease = {
  id: string;
  supplierOfferId: string;
  sourceKey: string;
  leaseExpiresAt: Date | null;
};

function required(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`RECHECK_${field}_INVALID`);
  return normalized;
}

/**
 * Resolve only an active, unexpired lease owned by the authenticated source
 * while that exact Supplier/SupplierOffer remains currently authorized.
 */
export async function resolveInventoryRecheckLease(input: {
  jobId: string;
  leaseToken: string;
  sourceKey: string;
  now?: Date;
}): Promise<BoundInventoryRecheckLease> {
  const jobId = required(input.jobId, "JOB_ID", 128);
  const leaseToken = required(input.leaseToken, "LEASE_TOKEN", 400);
  const sourceKey = required(input.sourceKey, "SOURCE_KEY", 180);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("RECHECK_NOW_INVALID");
  const minSourceVerifiedAt = new Date(now.getTime() - DIRECT_RESALE_SOURCE_MAX_AGE_MS);
  const maxSourceVerifiedAt = new Date(now.getTime() + SOURCE_VERIFICATION_FUTURE_TOLERANCE_MS);

  const rows = await prisma.$queryRaw<BoundInventoryRecheckLease[]>`
    SELECT job."id", job."supplierOfferId", job."sourceKey", job."leaseExpiresAt"
    FROM "InventoryRecheckJob" AS job
    INNER JOIN "SupplierOffer" AS offer
      ON offer."id" = job."supplierOfferId"
     AND offer."active" = TRUE
    INNER JOIN "Supplier" AS supplier
      ON supplier."id" = offer."supplierId"
    WHERE job."id" = ${jobId}
      AND job."status" = 'leased'
      AND job."leaseToken" = ${leaseToken}
      AND job."sourceKey" = ${sourceKey}
      AND supplier."key" = ${sourceKey}
      AND supplier."active" = TRUE
      AND supplier."resaleAllowed" = TRUE
      AND supplier."sourceVerifiedAt" IS NOT NULL
      AND supplier."sourceVerifiedAt" >= ${minSourceVerifiedAt}
      AND supplier."sourceVerifiedAt" <= ${maxSourceVerifiedAt}
      AND (
        supplier."sourceClass" = ${DIRECT_RESALE_SOURCE_CLASSES[0]} OR
        supplier."sourceClass" = ${DIRECT_RESALE_SOURCE_CLASSES[1]} OR
        supplier."sourceClass" = ${DIRECT_RESALE_SOURCE_CLASSES[2]} OR
        supplier."sourceClass" = ${DIRECT_RESALE_SOURCE_CLASSES[3]} OR
        supplier."sourceClass" = ${DIRECT_RESALE_SOURCE_CLASSES[4]}
      )
      AND job."leaseExpiresAt" IS NOT NULL
      AND job."leaseExpiresAt" > ${now}
    LIMIT 1
  `;
  const lease = rows[0];
  if (!lease) throw new Error("RECHECK_LEASE_INVALID");
  return lease;
}
