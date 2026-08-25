import { prisma } from "./db";

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

/** Resolve only an active, unexpired lease owned by the authenticated source. */
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

  const rows = await prisma.$queryRaw<BoundInventoryRecheckLease[]>`
    SELECT "id", "supplierOfferId", "sourceKey", "leaseExpiresAt"
    FROM "InventoryRecheckJob"
    WHERE "id" = ${jobId}
      AND "status" = 'leased'
      AND "leaseToken" = ${leaseToken}
      AND "sourceKey" = ${sourceKey}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${now}
    LIMIT 1
  `;
  const lease = rows[0];
  if (!lease) throw new Error("RECHECK_LEASE_INVALID");
  return lease;
}
