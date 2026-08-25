-- DealForge Phase 3 — durable supplier-offer inventory observation journal v1
-- Additive only. This records normalized freshness evidence; it does not enable
-- commerce, purchase from suppliers, or alter existing catalog availability.

CREATE TABLE "InventoryObservation" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "supplierOfferId" TEXT NOT NULL,
  "availability" TEXT NOT NULL,
  "quantity" INTEGER,
  "inventoryConfidenceBps" INTEGER NOT NULL,
  "observedPriceCents" INTEGER,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verificationMethod" TEXT NOT NULL,
  "provenance" TEXT NOT NULL,
  "sourceHealth" TEXT NOT NULL DEFAULT 'healthy',
  "sourceStatusDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryObservation_confidence_check" CHECK ("inventoryConfidenceBps" >= 0 AND "inventoryConfidenceBps" <= 10000),
  CONSTRAINT "InventoryObservation_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0),
  CONSTRAINT "InventoryObservation_price_check" CHECK ("observedPriceCents" IS NULL OR "observedPriceCents" >= 0),
  CONSTRAINT "InventoryObservation_window_check" CHECK ("expiresAt" > "observedAt")
);

CREATE UNIQUE INDEX "InventoryObservation_idempotencyKey_key"
  ON "InventoryObservation"("idempotencyKey");
CREATE INDEX "InventoryObservation_supplierOfferId_observedAt_idx"
  ON "InventoryObservation"("supplierOfferId", "observedAt" DESC);
CREATE INDEX "InventoryObservation_expiresAt_idx"
  ON "InventoryObservation"("expiresAt");
CREATE INDEX "InventoryObservation_sourceHealth_idx"
  ON "InventoryObservation"("sourceHealth");

ALTER TABLE "InventoryObservation"
  ADD CONSTRAINT "InventoryObservation_supplierOfferId_fkey"
  FOREIGN KEY ("supplierOfferId") REFERENCES "SupplierOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
