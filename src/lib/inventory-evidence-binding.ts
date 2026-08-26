import { createHash } from "node:crypto";
import { MIN_INVENTORY_CONFIDENCE_BPS } from "./commercialization";
import {
  buildInventoryObservationIdempotencyKey,
  evaluateInventoryFreshness,
  type InventoryObservationSnapshot,
} from "./inventory-freshness";
import { readLatestInventoryObservation } from "./inventory-observation-store";

export type InventoryEvidenceV1 = {
  version: 1;
  supplierOfferId: string;
  idempotencyKey: string;
  availability: string;
  quantity: number | null;
  inventoryConfidenceBps: number;
  observedPriceCents: number | null;
  observedAt: string;
  expiresAt: string;
  verificationMethod: string;
  provenanceHash: string;
  sourceHealth: string;
};

export type InventoryEvidenceDecision = {
  allowed: boolean;
  reasons: string[];
  evidence: InventoryEvidenceV1 | null;
};

function clean(value: string | null | undefined, fallback = "") {
  return value?.trim() || fallback;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildEvidence(observation: InventoryObservationSnapshot): InventoryEvidenceV1 | null {
  if (!observation.observedAt || !observation.expiresAt) return null;
  const verificationMethod = clean(observation.verificationMethod).toLowerCase();
  const provenance = clean(observation.provenance);
  if (!verificationMethod || !provenance) return null;
  const availability = clean(observation.availability).toLowerCase();
  const idempotencyKey = buildInventoryObservationIdempotencyKey({
    supplierOfferId: observation.supplierOfferId,
    observedAt: observation.observedAt,
    availability,
    observedPriceCents: observation.observedPriceCents ?? null,
    quantity: observation.quantity ?? null,
    verificationMethod,
    provenance,
  });
  return {
    version: 1,
    supplierOfferId: observation.supplierOfferId,
    idempotencyKey,
    availability,
    quantity: observation.quantity ?? null,
    inventoryConfidenceBps: observation.inventoryConfidenceBps,
    observedPriceCents: observation.observedPriceCents ?? null,
    observedAt: observation.observedAt.toISOString(),
    expiresAt: observation.expiresAt.toISOString(),
    verificationMethod,
    provenanceHash: sha256(provenance),
    sourceHealth: clean(observation.sourceHealth, "healthy").toLowerCase(),
  };
}

export function evaluateInventoryEvidenceBinding(
  observation: InventoryObservationSnapshot | null | undefined,
  expected: { supplierOfferId: string; itemCostCents: number },
  nowMs = Date.now(),
): InventoryEvidenceDecision {
  const freshness = evaluateInventoryFreshness(
    observation,
    { minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS, requireCurrent: true },
    nowMs,
  );
  const reasons = [...freshness.reasons];
  if (!observation) return { allowed: false, reasons, evidence: null };
  if (observation.supplierOfferId !== expected.supplierOfferId) reasons.push("inventory_offer_binding_mismatch");
  if (
    observation.observedPriceCents !== null &&
    observation.observedPriceCents !== undefined &&
    observation.observedPriceCents !== expected.itemCostCents
  ) reasons.push("observed_supplier_price_drift");
  const evidence = buildEvidence(observation);
  if (!evidence) reasons.push("inventory_evidence_unserializable");
  return { allowed: reasons.length === 0, reasons, evidence };
}

export async function resolveCurrentInventoryEvidence(
  supplierOfferId: string,
  itemCostCents: number,
  nowMs = Date.now(),
) {
  const observation = await readLatestInventoryObservation(supplierOfferId);
  return evaluateInventoryEvidenceBinding(observation, { supplierOfferId, itemCostCents }, nowMs);
}

export function bindInventoryEvidenceToSpecifications(
  specifications: string,
  persistedOfferId: string,
  evidence: InventoryEvidenceV1,
) {
  const root = JSON.parse(specifications) as Record<string, unknown>;
  const raw = root.supplierOfferV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("COMMERCIALIZATION_SNAPSHOT_INVALID");
  const offer = raw as Record<string, unknown>;
  const boundOfferId = typeof offer.persistedOfferId === "string" ? offer.persistedOfferId : null;
  if (boundOfferId && boundOfferId !== persistedOfferId) throw new Error("INVENTORY_EVIDENCE_OFFER_MISMATCH");
  root.supplierOfferV1 = {
    ...offer,
    inventoryEvidenceV1: evidence,
  };
  return JSON.stringify(root);
}

export function refreshBoundInventoryEvidence(
  specifications: string,
  persistedOfferId: string,
  evidence: InventoryEvidenceV1,
) {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const raw = root.supplierOfferV1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const offer = raw as Record<string, unknown>;
    if (offer.persistedOfferId !== persistedOfferId) return null;
    root.supplierOfferV1 = { ...offer, inventoryEvidenceV1: evidence };
    return JSON.stringify(root);
  } catch {
    return null;
  }
}
