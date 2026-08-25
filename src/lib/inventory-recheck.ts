import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./db";

const MAX_CLAIM_BATCH = 25;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 15 * 60;
const MAX_ERROR_LENGTH = 1000;
const MAX_REASON_LENGTH = 120;
const MAX_SOURCE_KEY_LENGTH = 180;

export type InventoryRecheckLease = {
  id: string;
  supplierOfferId: string;
  sourceKey: string;
  reason: string;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

type ScheduledJobRow = {
  id: string;
  supplierOfferId: string;
  sourceKey: string;
  reason: string;
  status: string;
  dueAt: Date;
};

type ClaimedJobRow = InventoryRecheckLease;

type LeaseStateRow = {
  id: string;
  supplierOfferId: string;
  sourceKey: string;
  reason: string;
  attemptCount: number;
  maxAttempts: number;
};

function cleanText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`RECHECK_${field}_INVALID`);
  return normalized;
}

function safeDate(value: Date, field: string) {
  const ms = value.getTime();
  if (!Number.isFinite(ms)) throw new Error(`RECHECK_${field}_INVALID`);
  return value;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function idempotencyKey(input: {
  supplierOfferId: string;
  sourceKey: string;
  reason: string;
  dueAt: Date;
}) {
  const canonical = [
    input.supplierOfferId,
    input.sourceKey,
    input.reason,
    input.dueAt.toISOString(),
  ].join("|");
  return `inventory_recheck_v1_${createHash("sha256").update(canonical).digest("hex")}`;
}

async function productEnginePaused() {
  const config = await prisma.productEngineConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
    select: { paused: true },
  });
  return config.paused;
}

async function audit(actor: string, action: string, detail: Record<string, unknown>) {
  await prisma.productEngineAudit.create({
    data: {
      candidateId: null,
      actor,
      action,
      detail: JSON.stringify(detail),
    },
  });
}

/**
 * Queue a verification request for an exact persisted offer. The supplier key
 * is derived from normalized persistence rather than trusted from the caller.
 */
export async function scheduleInventoryRecheck(input: {
  supplierOfferId: string;
  dueAt: Date;
  reason: string;
  actor: string;
  maxAttempts?: number;
}) {
  const supplierOfferId = cleanText(input.supplierOfferId, "SUPPLIER_OFFER_ID", 128);
  const reason = cleanText(input.reason, "REASON", MAX_REASON_LENGTH).toLowerCase();
  const dueAt = safeDate(input.dueAt, "DUE_AT");
  const maxAttempts = clampInt(input.maxAttempts ?? 5, 1, 12);

  const offer = await prisma.supplierOffer.findUnique({
    where: { id: supplierOfferId },
    select: {
      id: true,
      active: true,
      supplier: { select: { key: true, active: true, resaleAllowed: true } },
    },
  });
  if (!offer) throw new Error("RECHECK_SUPPLIER_OFFER_NOT_FOUND");
  if (!offer.active || !offer.supplier.active || !offer.supplier.resaleAllowed) {
    throw new Error("RECHECK_SUPPLIER_OFFER_NOT_ELIGIBLE");
  }
  const sourceKey = cleanText(offer.supplier.key, "SOURCE_KEY", MAX_SOURCE_KEY_LENGTH);
  const key = idempotencyKey({ supplierOfferId, sourceKey, reason, dueAt });
  const id = `recheck_${randomUUID()}`;

  const rows = await prisma.$queryRaw<ScheduledJobRow[]>`
    INSERT INTO "InventoryRecheckJob" (
      "id", "idempotencyKey", "supplierOfferId", "sourceKey", "reason",
      "status", "dueAt", "attemptCount", "maxAttempts", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${key}, ${supplierOfferId}, ${sourceKey}, ${reason},
      'pending', ${dueAt}, 0, ${maxAttempts}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("idempotencyKey") DO UPDATE SET "updatedAt" = "InventoryRecheckJob"."updatedAt"
    RETURNING "id", "supplierOfferId", "sourceKey", "reason", "status", "dueAt"
  `;
  const job = rows[0];
  if (!job) throw new Error("RECHECK_SCHEDULE_FAILED");

  await audit(input.actor, "inventory_recheck_scheduled", {
    jobId: job.id,
    supplierOfferId,
    sourceKey,
    reason,
    dueAt: dueAt.toISOString(),
  });
  return job;
}

/**
 * Lease a bounded batch for one normalized source only. Keeping claims source-
 * scoped gives each authorized adapter an explicit pacing boundary; callers
 * cannot accidentally fan out across every supplier in one request.
 */
export async function claimDueInventoryRechecks(input: {
  sourceKey: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  actor: string;
  now?: Date;
}) {
  if (await productEnginePaused()) return { paused: true as const, leases: [] as InventoryRecheckLease[] };

  const sourceKey = cleanText(input.sourceKey, "SOURCE_KEY", MAX_SOURCE_KEY_LENGTH);
  const workerId = cleanText(input.workerId, "WORKER_ID", 160);
  const limit = clampInt(input.limit ?? 5, 1, MAX_CLAIM_BATCH);
  const leaseSeconds = clampInt(input.leaseSeconds ?? 180, MIN_LEASE_SECONDS, MAX_LEASE_SECONDS);
  const now = safeDate(input.now ?? new Date(), "NOW");
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  const leaseTokenPrefix = `${workerId}:${randomUUID()}`;

  const rows = await prisma.$queryRaw<ClaimedJobRow[]>`
    WITH claimable AS (
      SELECT "id"
      FROM "InventoryRecheckJob"
      WHERE "sourceKey" = ${sourceKey}
        AND "status" IN ('pending', 'retry', 'leased')
        AND "attemptCount" < "maxAttempts"
        AND "dueAt" <= ${now}
        AND ("status" <> 'leased' OR "leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
      ORDER BY "dueAt" ASC, "createdAt" ASC, "id" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "InventoryRecheckJob" AS job
    SET "status" = 'leased',
        "attemptCount" = job."attemptCount" + 1,
        "leaseToken" = ${leaseTokenPrefix} || ':' || job."id",
        "leaseExpiresAt" = ${leaseExpiresAt},
        "updatedAt" = CURRENT_TIMESTAMP
    FROM claimable
    WHERE job."id" = claimable."id"
    RETURNING job."id", job."supplierOfferId", job."sourceKey", job."reason",
      job."attemptCount", job."maxAttempts", job."leaseToken", job."leaseExpiresAt"
  `;

  await audit(input.actor, "inventory_recheck_claimed", {
    workerId,
    sourceKey,
    requested: limit,
    leased: rows.length,
    leaseSeconds,
    jobIds: rows.map((row) => row.id),
  });
  return { paused: false as const, leases: rows };
}

export async function completeInventoryRecheck(input: {
  jobId: string;
  leaseToken: string;
  actor: string;
  nextDueAt?: Date | null;
}) {
  const jobId = cleanText(input.jobId, "JOB_ID", 128);
  const leaseToken = cleanText(input.leaseToken, "LEASE_TOKEN", 400);
  const nextDueAt = input.nextDueAt ? safeDate(input.nextDueAt, "NEXT_DUE_AT") : null;

  const rows = await prisma.$queryRaw<LeaseStateRow[]>`
    UPDATE "InventoryRecheckJob"
    SET "status" = 'completed', "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${jobId} AND "status" = 'leased' AND "leaseToken" = ${leaseToken}
    RETURNING "id", "supplierOfferId", "sourceKey", "reason", "attemptCount", "maxAttempts"
  `;
  const job = rows[0];
  if (!job) throw new Error("RECHECK_LEASE_INVALID");

  await audit(input.actor, "inventory_recheck_completed", {
    jobId,
    supplierOfferId: job.supplierOfferId,
    sourceKey: job.sourceKey,
    attemptCount: job.attemptCount,
  });

  let nextJob: ScheduledJobRow | null = null;
  if (nextDueAt) {
    nextJob = await scheduleInventoryRecheck({
      supplierOfferId: job.supplierOfferId,
      dueAt: nextDueAt,
      reason: "periodic",
      actor: input.actor,
      maxAttempts: job.maxAttempts,
    });
  }
  return { completed: true as const, jobId, nextJob };
}

export async function failInventoryRecheck(input: {
  jobId: string;
  leaseToken: string;
  error: string;
  actor: string;
  now?: Date;
}) {
  const jobId = cleanText(input.jobId, "JOB_ID", 128);
  const leaseToken = cleanText(input.leaseToken, "LEASE_TOKEN", 400);
  const error = cleanText(input.error, "ERROR", MAX_ERROR_LENGTH);
  const now = safeDate(input.now ?? new Date(), "NOW");

  const rows = await prisma.$queryRaw<LeaseStateRow[]>`
    SELECT "id", "supplierOfferId", "sourceKey", "reason", "attemptCount", "maxAttempts"
    FROM "InventoryRecheckJob"
    WHERE "id" = ${jobId} AND "status" = 'leased' AND "leaseToken" = ${leaseToken}
    LIMIT 1
  `;
  const job = rows[0];
  if (!job) throw new Error("RECHECK_LEASE_INVALID");

  const dead = job.attemptCount >= job.maxAttempts;
  const backoffSeconds = Math.min(3600, 60 * 2 ** Math.max(0, job.attemptCount - 1));
  const retryAt = new Date(now.getTime() + backoffSeconds * 1000);

  const updated = await prisma.$executeRaw`
    UPDATE "InventoryRecheckJob"
    SET "status" = ${dead ? "dead_letter" : "retry"},
        "dueAt" = ${dead ? now : retryAt},
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "lastError" = ${error},
        "deadLetteredAt" = ${dead ? now : null},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${jobId} AND "status" = 'leased' AND "leaseToken" = ${leaseToken}
  `;
  if (updated !== 1) throw new Error("RECHECK_LEASE_INVALID");

  await audit(input.actor, dead ? "inventory_recheck_dead_lettered" : "inventory_recheck_retry_scheduled", {
    jobId,
    supplierOfferId: job.supplierOfferId,
    sourceKey: job.sourceKey,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    retryAt: dead ? null : retryAt.toISOString(),
    error,
  });

  return {
    jobId,
    status: dead ? "dead_letter" as const : "retry" as const,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    retryAt: dead ? null : retryAt,
  };
}

export async function inventoryRecheckQueueSummary() {
  const rows = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT "status", COUNT(*)::bigint AS "count"
    FROM "InventoryRecheckJob"
    GROUP BY "status"
    ORDER BY "status" ASC
  `;
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}
