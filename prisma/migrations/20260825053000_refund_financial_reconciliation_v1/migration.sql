-- DealForge Phase 3 — authoritative refund-side Stripe financial reconciliation v1
-- Durable audit journal for Stripe balance transactions linked to refunds.
-- Refund principal is already represented in the Refund ledger; this table records
-- Stripe account-balance impact and fees without double-counting customer refunds.

CREATE TABLE "RefundFinancialEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "providerRefundId" TEXT NOT NULL,
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

CREATE UNIQUE INDEX "RefundFinancialEvent_eventKey_key"
  ON "RefundFinancialEvent"("eventKey");
CREATE UNIQUE INDEX "RefundFinancialEvent_providerBalanceTransactionId_key"
  ON "RefundFinancialEvent"("providerBalanceTransactionId");
CREATE INDEX "RefundFinancialEvent_refundId_createdAt_idx"
  ON "RefundFinancialEvent"("refundId", "createdAt");
CREATE INDEX "RefundFinancialEvent_kind_createdAt_idx"
  ON "RefundFinancialEvent"("kind", "createdAt");

ALTER TABLE "RefundFinancialEvent"
  ADD CONSTRAINT "RefundFinancialEvent_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
