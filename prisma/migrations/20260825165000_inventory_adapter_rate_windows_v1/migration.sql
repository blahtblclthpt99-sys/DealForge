-- DealForge Phase 3 — source-scoped inventory adapter pacing v1
-- Additive only. Tracks authenticated machine request/claim volume per
-- adapter + normalized source + fixed time window. No commerce, payment,
-- catalog promotion, or procurement authority is introduced.

CREATE TABLE "InventoryAdapterRateWindow" (
  "id" TEXT NOT NULL,
  "adapterId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "claimUnits" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAdapterRateWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryAdapterRateWindow_window_check" CHECK ("windowSeconds" BETWEEN 10 AND 3600),
  CONSTRAINT "InventoryAdapterRateWindow_requests_check" CHECK ("requestCount" >= 0),
  CONSTRAINT "InventoryAdapterRateWindow_claims_check" CHECK ("claimUnits" >= 0)
);

CREATE UNIQUE INDEX "InventoryAdapterRateWindow_scope_window_key"
  ON "InventoryAdapterRateWindow"("adapterId", "sourceKey", "windowStart");
CREATE INDEX "InventoryAdapterRateWindow_window_idx"
  ON "InventoryAdapterRateWindow"("windowStart");
CREATE INDEX "InventoryAdapterRateWindow_source_idx"
  ON "InventoryAdapterRateWindow"("sourceKey", "windowStart");
