-- DealForge Phase 3 — signed inventory adapter replay protection v1
-- Additive only. Stores hashes of accepted adapter nonces so signed requests
-- cannot be replayed. No customer, payment, or procurement state is touched.

CREATE TABLE "InventoryAdapterNonce" (
  "id" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "adapterId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAdapterNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryAdapterNonce_nonceHash_key"
  ON "InventoryAdapterNonce"("nonceHash");
CREATE INDEX "InventoryAdapterNonce_expires_idx"
  ON "InventoryAdapterNonce"("expiresAt");
CREATE INDEX "InventoryAdapterNonce_adapter_source_idx"
  ON "InventoryAdapterNonce"("adapterId", "sourceKey", "createdAt");
