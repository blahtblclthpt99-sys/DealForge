-- Product Engine safe-intake migration.
-- Additive only: preserves the existing catalog and operational tables.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "priceSource" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "priceVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "metadataSource" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "metadataVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProductCandidate" (
  "id" TEXT NOT NULL,
  "asin" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "sourceObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scout" TEXT NOT NULL,
  "titleCandidate" TEXT,
  "brandCandidate" TEXT,
  "descriptionCandidate" TEXT,
  "imagesCandidate" TEXT NOT NULL DEFAULT '[]',
  "categoryCandidate" TEXT,
  "normalizedCategory" TEXT,
  "ownerSpecialLink" TEXT,
  "variationKey" TEXT,
  "state" TEXT NOT NULL DEFAULT 'discovered',
  "validationResult" TEXT NOT NULL DEFAULT 'pending',
  "validationDetail" TEXT NOT NULL DEFAULT '{}',
  "classification" TEXT,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejectionReason" TEXT,
  "duplicateOfId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deadLetteredAt" TIMESTAMP(3),
  "publishedProductId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCandidate_asin_key" ON "ProductCandidate"("asin");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductCandidate_idempotencyKey_key" ON "ProductCandidate"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProductCandidate_state_nextAttemptAt_idx" ON "ProductCandidate"("state", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "ProductCandidate_normalizedCategory_idx" ON "ProductCandidate"("normalizedCategory");
CREATE INDEX IF NOT EXISTS "ProductCandidate_scout_idx" ON "ProductCandidate"("scout");
CREATE INDEX IF NOT EXISTS "ProductCandidate_variationKey_idx" ON "ProductCandidate"("variationKey");
CREATE INDEX IF NOT EXISTS "ProductCandidate_createdAt_idx" ON "ProductCandidate"("createdAt");

CREATE TABLE IF NOT EXISTS "ProductEngineWorkerState" (
  "id" TEXT NOT NULL,
  "worker" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "healthy" BOOLEAN NOT NULL DEFAULT true,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEngineWorkerState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductEngineWorkerState_worker_key" ON "ProductEngineWorkerState"("worker");

CREATE TABLE IF NOT EXISTS "ProductEngineConfig" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "acceptanceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 70,
  "categoryQuota" INTEGER NOT NULL DEFAULT 50,
  "maxConcurrency" INTEGER NOT NULL DEFAULT 4,
  "maxVariations" INTEGER NOT NULL DEFAULT 3,
  "lastRunAt" TIMESTAMP(3),
  "lastPublishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEngineConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductEngineAudit" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromState" TEXT,
  "toState" TEXT,
  "detail" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEngineAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProductEngineAudit_candidateId_idx" ON "ProductEngineAudit"("candidateId");
CREATE INDEX IF NOT EXISTS "ProductEngineAudit_action_idx" ON "ProductEngineAudit"("action");
CREATE INDEX IF NOT EXISTS "ProductEngineAudit_createdAt_idx" ON "ProductEngineAudit"("createdAt");
