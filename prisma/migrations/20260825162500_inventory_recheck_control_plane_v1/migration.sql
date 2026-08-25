-- DealForge Phase 3 — durable inventory recheck control plane v1
-- Additive only. This queue schedules verification work; it cannot enable
-- commerce, purchase inventory, or manufacture source observations.

CREATE TABLE "InventoryRecheckJob" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "supplierOfferId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deadLetteredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryRecheckJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryRecheckJob_attempts_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "InventoryRecheckJob_maxAttempts_check" CHECK ("maxAttempts" BETWEEN 1 AND 12),
  CONSTRAINT "InventoryRecheckJob_status_check" CHECK ("status" IN ('pending','leased','retry','completed','dead_letter'))
);

CREATE UNIQUE INDEX "InventoryRecheckJob_idempotencyKey_key"
  ON "InventoryRecheckJob"("idempotencyKey");
CREATE INDEX "InventoryRecheckJob_due_idx"
  ON "InventoryRecheckJob"("status", "dueAt", "createdAt");
CREATE INDEX "InventoryRecheckJob_offer_idx"
  ON "InventoryRecheckJob"("supplierOfferId", "createdAt");
CREATE INDEX "InventoryRecheckJob_source_idx"
  ON "InventoryRecheckJob"("sourceKey", "status", "dueAt");
CREATE INDEX "InventoryRecheckJob_lease_idx"
  ON "InventoryRecheckJob"("leaseExpiresAt");

ALTER TABLE "InventoryRecheckJob"
  ADD CONSTRAINT "InventoryRecheckJob_supplierOfferId_fkey"
  FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
