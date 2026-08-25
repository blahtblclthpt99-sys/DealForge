-- DealForge Phase 3 — authoritative order destination v1
-- Persist the fulfillment destination supplied by signature-verified Stripe
-- Checkout Session events. This is intentionally independent of browser state.

CREATE TABLE "OrderDestination" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'stripe_checkout',
  "sourceEventId" TEXT NOT NULL,
  "stripeCheckoutSessionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
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
  CONSTRAINT "OrderDestination_source_check" CHECK ("source" = 'stripe_checkout'),
  CONSTRAINT "OrderDestination_session_check" CHECK ("stripeCheckoutSessionId" LIKE 'cs_%'),
  CONSTRAINT "OrderDestination_event_check" CHECK ("sourceEventId" LIKE 'evt_%'),
  CONSTRAINT "OrderDestination_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
  CONSTRAINT "OrderDestination_name_check" CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "OrderDestination_line1_check" CHECK (char_length(btrim("line1")) > 0),
  CONSTRAINT "OrderDestination_city_check" CHECK (char_length(btrim("city")) > 0),
  CONSTRAINT "OrderDestination_postal_check" CHECK (char_length(btrim("postalCode")) > 0)
);

CREATE UNIQUE INDEX "OrderDestination_orderId_key"
  ON "OrderDestination"("orderId");
CREATE UNIQUE INDEX "OrderDestination_stripeCheckoutSessionId_key"
  ON "OrderDestination"("stripeCheckoutSessionId");
CREATE INDEX "OrderDestination_country_idx"
  ON "OrderDestination"("country");
CREATE INDEX "OrderDestination_sourceEventId_idx"
  ON "OrderDestination"("sourceEventId");

-- A destination is an immutable transaction snapshot. A changed shipping
-- destination must become an explicit future workflow, never an in-place edit.
CREATE OR REPLACE FUNCTION "prevent_order_destination_update"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OrderDestination is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderDestination_prevent_update"
BEFORE UPDATE ON "OrderDestination"
FOR EACH ROW EXECUTE FUNCTION "prevent_order_destination_update"();
