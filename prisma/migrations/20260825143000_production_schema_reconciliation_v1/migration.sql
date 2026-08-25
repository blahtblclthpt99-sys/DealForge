-- DealForge production schema reconciliation v1
-- Additive/idempotent repair for production databases that predate the normalized
-- Product Engine / supplier / procurement / refund-reconciliation / Savings Fund
-- tables but already contain the Phase 2.5 order/payment schema.
--
-- This migration must remain safe on a clean database where all earlier migrations
-- have already run. It does not enable commerce or authorize supplier purchasing.

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

CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceClass" TEXT NOT NULL,
  "websiteUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "resaleAllowed" BOOLEAN NOT NULL DEFAULT false,
  "sourceVerifiedAt" TIMESTAMP(3),
  "verificationSource" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_key_key" ON "Supplier"("key");
CREATE INDEX IF NOT EXISTS "Supplier_active_idx" ON "Supplier"("active");
CREATE INDEX IF NOT EXISTS "Supplier_sourceClass_idx" ON "Supplier"("sourceClass");
CREATE INDEX IF NOT EXISTS "Supplier_sourceVerifiedAt_idx" ON "Supplier"("sourceVerifiedAt");

CREATE TABLE IF NOT EXISTS "SupplierOffer" (
  "id" TEXT NOT NULL,
  "offerKey" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "externalOfferId" TEXT,
  "sourceUrl" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "availability" TEXT NOT NULL DEFAULT 'unknown',
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "itemCostCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "supplierFeeCents" INTEGER NOT NULL DEFAULT 0,
  "handlingCents" INTEGER NOT NULL DEFAULT 0,
  "priceVerifiedAt" TIMESTAMP(3),
  "inventoryConfidenceBps" INTEGER NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierOffer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierOffer_offerKey_key" ON "SupplierOffer"("offerKey");
CREATE INDEX IF NOT EXISTS "SupplierOffer_productId_active_idx" ON "SupplierOffer"("productId", "active");
CREATE INDEX IF NOT EXISTS "SupplierOffer_supplierId_active_idx" ON "SupplierOffer"("supplierId", "active");
CREATE INDEX IF NOT EXISTS "SupplierOffer_availability_idx" ON "SupplierOffer"("availability");
CREATE INDEX IF NOT EXISTS "SupplierOffer_priceVerifiedAt_idx" ON "SupplierOffer"("priceVerifiedAt");
CREATE INDEX IF NOT EXISTS "SupplierOffer_priority_idx" ON "SupplierOffer"("priority");

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "supplierSnapshot" TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "Product_commerceEnabled_idx" ON "Product"("commerceEnabled");

CREATE TABLE IF NOT EXISTS "ProcurementIntent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderItemId" TEXT NOT NULL REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
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
CREATE UNIQUE INDEX IF NOT EXISTS "ProcurementIntent_idempotencyKey_key" ON "ProcurementIntent"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ProcurementIntent_orderItemId_key" ON "ProcurementIntent"("orderItemId");
CREATE INDEX IF NOT EXISTS "ProcurementIntent_orderId_status_idx" ON "ProcurementIntent"("orderId", "status");
CREATE INDEX IF NOT EXISTS "ProcurementIntent_status_createdAt_idx" ON "ProcurementIntent"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ProcurementEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "procurementIntentId" TEXT NOT NULL REFERENCES "ProcurementIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcurementEvent_eventKey_key" ON "ProcurementEvent"("eventKey");
CREATE INDEX IF NOT EXISTS "ProcurementEvent_procurementIntentId_createdAt_idx" ON "ProcurementEvent"("procurementIntentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProcurementEvent_type_createdAt_idx" ON "ProcurementEvent"("type", "createdAt");

CREATE TABLE IF NOT EXISTS "RefundFinancialEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "refundId" TEXT NOT NULL REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "providerRefundId" TEXT NOT NULL,
  "paymentIntentId" TEXT,
  "providerEventId" TEXT,
  "providerBalanceTransactionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "feeCents" INTEGER NOT NULL,
  "netCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "transactionType" TEXT NOT NULL,
  "reportingCategory" TEXT,
  "sourceObjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundFinancialEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RefundFinancialEvent_eventKey_key" ON "RefundFinancialEvent"("eventKey");
CREATE UNIQUE INDEX IF NOT EXISTS "RefundFinancialEvent_providerBalanceTransactionId_key" ON "RefundFinancialEvent"("providerBalanceTransactionId");
CREATE INDEX IF NOT EXISTS "RefundFinancialEvent_refundId_createdAt_idx" ON "RefundFinancialEvent"("refundId", "createdAt");
CREATE INDEX IF NOT EXISTS "RefundFinancialEvent_kind_createdAt_idx" ON "RefundFinancialEvent"("kind", "createdAt");

CREATE TABLE IF NOT EXISTS "SavingsFundEntry" (
  "id" TEXT NOT NULL,
  "entryKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "orderId" TEXT,
  "refundId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "sourceProfitCents" INTEGER,
  "policyVersion" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT TRUE,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavingsFundEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavingsFundEntry_amount_nonzero" CHECK ("amountCents" <> 0),
  CONSTRAINT "SavingsFundEntry_phase_a_type" CHECK ("type" IN ('accrual', 'reversal', 'adjustment')),
  CONSTRAINT "SavingsFundEntry_currency_valid" CHECK (char_length("currency") = 3),
  CONSTRAINT "SavingsFundEntry_phase_a_dry_run" CHECK ("dryRun" = TRUE)
);
CREATE UNIQUE INDEX IF NOT EXISTS "SavingsFundEntry_entryKey_key" ON "SavingsFundEntry"("entryKey");
CREATE INDEX IF NOT EXISTS "SavingsFundEntry_currency_createdAt_idx" ON "SavingsFundEntry"("currency", "createdAt");
CREATE INDEX IF NOT EXISTS "SavingsFundEntry_type_createdAt_idx" ON "SavingsFundEntry"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "SavingsFundEntry_orderId_createdAt_idx" ON "SavingsFundEntry"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavingsFundEntry_refundId_createdAt_idx" ON "SavingsFundEntry"("refundId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavingsFundEntry_dryRun_createdAt_idx" ON "SavingsFundEntry"("dryRun", "createdAt");

CREATE OR REPLACE FUNCTION "prevent_savings_fund_entry_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SavingsFundEntry is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "SavingsFundEntry_prevent_update" ON "SavingsFundEntry";
CREATE TRIGGER "SavingsFundEntry_prevent_update"
BEFORE UPDATE ON "SavingsFundEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_savings_fund_entry_mutation"();

DROP TRIGGER IF EXISTS "SavingsFundEntry_prevent_delete" ON "SavingsFundEntry";
CREATE TRIGGER "SavingsFundEntry_prevent_delete"
BEFORE DELETE ON "SavingsFundEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_savings_fund_entry_mutation"();
