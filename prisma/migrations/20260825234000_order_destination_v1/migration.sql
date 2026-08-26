-- DealForge Phase 3 — authoritative order destination v1
-- Additive only. Persists the Stripe Checkout shipping destination that is
-- required before physical-goods procurement may be created.

CREATE TABLE "OrderDestination" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'stripe_checkout',
  "providerSessionId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "line1" TEXT NOT NULL,
  "line2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderDestination_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderDestination_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderDestination_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
  CONSTRAINT "OrderDestination_recipient_check" CHECK (length(btrim("recipientName")) > 0),
  CONSTRAINT "OrderDestination_line1_check" CHECK (length(btrim("line1")) > 0),
  CONSTRAINT "OrderDestination_city_check" CHECK (length(btrim("city")) > 0),
  CONSTRAINT "OrderDestination_postal_check" CHECK (length(btrim("postalCode")) > 0)
);

CREATE UNIQUE INDEX "OrderDestination_orderId_key"
  ON "OrderDestination"("orderId");
CREATE UNIQUE INDEX "OrderDestination_providerSessionId_key"
  ON "OrderDestination"("providerSessionId");
CREATE INDEX "OrderDestination_country_capturedAt_idx"
  ON "OrderDestination"("country", "capturedAt");
CREATE INDEX "OrderDestination_sourceEventId_idx"
  ON "OrderDestination"("sourceEventId");
