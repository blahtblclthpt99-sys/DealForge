-- DealForge Phase 3 — normalized supplier and supplier-offer persistence v1
-- This migration is data-additive only. It does not enable commerce, select a
-- supplier for purchase, or mutate existing Product commerce flags.

CREATE TABLE "Supplier" (
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

CREATE TABLE "SupplierOffer" (
  "id" TEXT NOT NULL,
  "offerKey" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
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

CREATE UNIQUE INDEX "Supplier_key_key" ON "Supplier"("key");
CREATE INDEX "Supplier_active_idx" ON "Supplier"("active");
CREATE INDEX "Supplier_sourceClass_idx" ON "Supplier"("sourceClass");
CREATE INDEX "Supplier_sourceVerifiedAt_idx" ON "Supplier"("sourceVerifiedAt");

CREATE UNIQUE INDEX "SupplierOffer_offerKey_key" ON "SupplierOffer"("offerKey");
CREATE INDEX "SupplierOffer_productId_active_idx" ON "SupplierOffer"("productId", "active");
CREATE INDEX "SupplierOffer_supplierId_active_idx" ON "SupplierOffer"("supplierId", "active");
CREATE INDEX "SupplierOffer_availability_idx" ON "SupplierOffer"("availability");
CREATE INDEX "SupplierOffer_priceVerifiedAt_idx" ON "SupplierOffer"("priceVerifiedAt");
CREATE INDEX "SupplierOffer_priority_idx" ON "SupplierOffer"("priority");

ALTER TABLE "SupplierOffer"
  ADD CONSTRAINT "SupplierOffer_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierOffer"
  ADD CONSTRAINT "SupplierOffer_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
