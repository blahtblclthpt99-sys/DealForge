-- Persist the exact supplier/source economics approved before Stripe Checkout.
-- Existing rows remain valid historical records with an empty legacy snapshot.
ALTER TABLE "OrderItem"
ADD COLUMN "supplierSnapshot" TEXT NOT NULL DEFAULT '{}';
