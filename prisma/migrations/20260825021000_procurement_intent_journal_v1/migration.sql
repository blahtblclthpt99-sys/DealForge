-- DealForge Phase 3 — paid-order procurement intent journal v1
-- This migration creates operational records only. It does not enable or
-- perform supplier purchasing, inventory reservation, or automatic procurement.

CREATE TABLE "ProcurementIntent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'awaiting_review',
  "executionMode" TEXT NOT NULL DEFAULT 'manual_only',
  "supplierSnapshot" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "expectedUnitCostCents" INTEGER,
  "expectedTotalCostCents" INTEGER,
  "currency" TEXT NOT NULL,
  "blockedReason" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "supplierOrderReference" TEXT,
  "actualTotalCostCents" INTEGER,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProcurementIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcurementEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "procurementIntentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcurementIntent_idempotencyKey_key"
  ON "ProcurementIntent"("idempotencyKey");
CREATE UNIQUE INDEX "ProcurementIntent_orderItemId_key"
  ON "ProcurementIntent"("orderItemId");
CREATE INDEX "ProcurementIntent_orderId_status_idx"
  ON "ProcurementIntent"("orderId", "status");
CREATE INDEX "ProcurementIntent_status_createdAt_idx"
  ON "ProcurementIntent"("status", "createdAt");

CREATE UNIQUE INDEX "ProcurementEvent_eventKey_key"
  ON "ProcurementEvent"("eventKey");
CREATE INDEX "ProcurementEvent_procurementIntentId_createdAt_idx"
  ON "ProcurementEvent"("procurementIntentId", "createdAt");
CREATE INDEX "ProcurementEvent_type_createdAt_idx"
  ON "ProcurementEvent"("type", "createdAt");

ALTER TABLE "ProcurementIntent"
  ADD CONSTRAINT "ProcurementIntent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcurementIntent"
  ADD CONSTRAINT "ProcurementIntent_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcurementEvent"
  ADD CONSTRAINT "ProcurementEvent_procurementIntentId_fkey"
  FOREIGN KEY ("procurementIntentId") REFERENCES "ProcurementIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
