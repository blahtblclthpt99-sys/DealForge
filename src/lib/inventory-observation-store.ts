import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import {
  buildInventoryObservationIdempotencyKey,
  type InventoryObservationSnapshot,
} from "./inventory-freshness";

export type RecordInventoryObservationInput = {
  supplierOfferId: string;
  availability: string;
  quantity?: number | null;
  inventoryConfidenceBps: number;
  observedPriceCents?: number | null;
  observedAt: Date;
  expiresAt: Date;
  verificationMethod: string;
  provenance: string;
  sourceHealth?: string | null;
  sourceStatusDetail?: string | null;
};

type InventoryObservationRow = {
  supplierOfferId: string;
  availability: string;
  quantity: number | null;
  inventoryConfidenceBps: number;
  observedAt: Date;
  expiresAt: Date;
  verificationMethod: string;
  provenance: string;
  sourceHealth: string;
};

function requiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`INVENTORY_${field}_INVALID`);
  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number) {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error("INVENTORY_OPTIONAL_TEXT_TOO_LONG");
  return normalized;
}

function nonNegativeInteger(value: number | null | undefined, field: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVENTORY_${field}_INVALID`);
  return value;
}

function normalizeInput(input: RecordInventoryObservationInput) {
  const supplierOfferId = requiredText(input.supplierOfferId, "SUPPLIER_OFFER_ID", 128);
  const availability = requiredText(input.availability, "AVAILABILITY", 40).toLowerCase();
  const verificationMethod = requiredText(input.verificationMethod, "VERIFICATION_METHOD", 80).toLowerCase();
  const provenance = requiredText(input.provenance, "PROVENANCE", 2000);
  const sourceHealth = (optionalText(input.sourceHealth, 80) ?? "healthy").toLowerCase();
  const sourceStatusDetail = optionalText(input.sourceStatusDetail, 2000);
  const quantity = nonNegativeInteger(input.quantity, "QUANTITY");
  const observedPriceCents = nonNegativeInteger(input.observedPriceCents, "PRICE");

  if (!Number.isSafeInteger(input.inventoryConfidenceBps) || input.inventoryConfidenceBps < 0 || input.inventoryConfidenceBps > 10_000) {
    throw new Error("INVENTORY_CONFIDENCE_INVALID");
  }
  const observedAtMs = input.observedAt.getTime();
  const expiresAtMs = input.expiresAt.getTime();
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= observedAtMs) {
    throw new Error("INVENTORY_WINDOW_INVALID");
  }

  return {
    supplierOfferId,
    availability,
    quantity,
    inventoryConfidenceBps: input.inventoryConfidenceBps,
    observedPriceCents,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    verificationMethod,
    provenance,
    sourceHealth,
    sourceStatusDetail,
  };
}

/**
 * Append one normalized observation. The deterministic idempotency key makes
 * retries harmless while retaining an immutable history for freshness audits.
 */
export async function recordInventoryObservation(input: RecordInventoryObservationInput) {
  const normalized = normalizeInput(input);
  const idempotencyKey = buildInventoryObservationIdempotencyKey({
    supplierOfferId: normalized.supplierOfferId,
    observedAt: normalized.observedAt,
    availability: normalized.availability,
    observedPriceCents: normalized.observedPriceCents,
    quantity: normalized.quantity,
    verificationMethod: normalized.verificationMethod,
    provenance: normalized.provenance,
  });

  const id = `inv_${randomUUID()}`;
  await prisma.$executeRaw`
    INSERT INTO "InventoryObservation" (
      "id", "idempotencyKey", "supplierOfferId", "availability", "quantity",
      "inventoryConfidenceBps", "observedPriceCents", "observedAt", "expiresAt",
      "verificationMethod", "provenance", "sourceHealth", "sourceStatusDetail", "createdAt"
    ) VALUES (
      ${id}, ${idempotencyKey}, ${normalized.supplierOfferId}, ${normalized.availability}, ${normalized.quantity},
      ${normalized.inventoryConfidenceBps}, ${normalized.observedPriceCents}, ${normalized.observedAt}, ${normalized.expiresAt},
      ${normalized.verificationMethod}, ${normalized.provenance}, ${normalized.sourceHealth}, ${normalized.sourceStatusDetail}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `;

  return { idempotencyKey };
}

/** Read-only checkout path: newest supplier-offer observation is authoritative. */
export async function readLatestInventoryObservation(
  supplierOfferId: string,
): Promise<InventoryObservationSnapshot | null> {
  const normalizedOfferId = requiredText(supplierOfferId, "SUPPLIER_OFFER_ID", 128);
  const rows = await prisma.$queryRaw<InventoryObservationRow[]>`
    SELECT
      "supplierOfferId", "availability", "quantity", "inventoryConfidenceBps",
      "observedAt", "expiresAt", "verificationMethod", "provenance", "sourceHealth"
    FROM "InventoryObservation"
    WHERE "supplierOfferId" = ${normalizedOfferId}
    ORDER BY "observedAt" DESC, "createdAt" DESC, "id" DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    supplierOfferId: row.supplierOfferId,
    availability: row.availability,
    quantity: row.quantity,
    inventoryConfidenceBps: row.inventoryConfidenceBps,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    verificationMethod: row.verificationMethod,
    provenance: row.provenance,
    sourceHealth: row.sourceHealth,
  };
}
