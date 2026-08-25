-- DealForge Customer Savings Fund — Phase A (measure only)
-- Append-only shadow ledger. Entries are accounting observations only and do
-- not authorize a checkout discount or move customer/supplier funds.

CREATE TABLE "SavingsFundEntry" (
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

CREATE UNIQUE INDEX "SavingsFundEntry_entryKey_key"
  ON "SavingsFundEntry"("entryKey");
CREATE INDEX "SavingsFundEntry_currency_createdAt_idx"
  ON "SavingsFundEntry"("currency", "createdAt");
CREATE INDEX "SavingsFundEntry_type_createdAt_idx"
  ON "SavingsFundEntry"("type", "createdAt");
CREATE INDEX "SavingsFundEntry_orderId_createdAt_idx"
  ON "SavingsFundEntry"("orderId", "createdAt");
CREATE INDEX "SavingsFundEntry_refundId_createdAt_idx"
  ON "SavingsFundEntry"("refundId", "createdAt");
CREATE INDEX "SavingsFundEntry_dryRun_createdAt_idx"
  ON "SavingsFundEntry"("dryRun", "createdAt");

-- Make the journal append-only at the database layer. Corrections must be new
-- reversal/adjustment entries; historical rows cannot be edited or deleted.
CREATE OR REPLACE FUNCTION "prevent_savings_fund_entry_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SavingsFundEntry is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SavingsFundEntry_prevent_update"
BEFORE UPDATE ON "SavingsFundEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_savings_fund_entry_mutation"();

CREATE TRIGGER "SavingsFundEntry_prevent_delete"
BEFORE DELETE ON "SavingsFundEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_savings_fund_entry_mutation"();
