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

export function inventoryEvidenceBindingRequired() {
  const configured = process.env.INVENTORY_EVIDENCE_BINDING_REQUIRED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

function clean(value: string | null | undefined, fallback = "") {
  return value?.trim() || fallback;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function safeNullableInteger(value: unknown) {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeEvidence(value: unknown): InventoryEvidenceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const supplierOfferId = safeString(raw.supplierOfferId, 128);
  const idempotencyKey = safeString(raw.idempotencyKey, 256);
  const availability = safeString(raw.availability, 40);
  const quantity = safeNullableInteger(raw.quantity);
  const inventoryConfidenceBps = typeof raw.inventoryConfidenceBps === "number" && Number.isSafeInteger(raw.inventoryConfidenceBps) && raw.inventoryConfidenceBps >= 0 && raw.inventoryConfidenceBps <= 10_000 ? raw.inventoryConfidenceBps : null;
  const observedPriceCents = safeNullableInteger(raw.observedPriceCents);
  const observedAtRaw = safeString(raw.observedAt, 64);
  const expiresAtRaw = safeString(raw.expiresAt, 64);
  const verificationMethod = safeString(raw.verificationMethod, 80);
  const provenanceHash = safeString(raw.provenanceHash, 128);
  const sourceHealth = safeString(raw.sourceHealth, 80);
  if (
    raw.version !== 1 || !supplierOfferId || !idempotencyKey || !availability || quantity === undefined ||
    inventoryConfidenceBps === null || observedPriceCents === undefined || !observedAtRaw || !expiresAtRaw ||
    !verificationMethod || !provenanceHash || !/^[a-f0-9]{64}$/i.test(provenanceHash) || !sourceHealth
  ) return null;
  const observedAt = Date.parse(observedAtRaw);
  const expiresAt = Date.parse(expiresAtRaw);
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= observedAt) return null;
  return {
    version: 1,
    supplierOfferId,
    idempotencyKey,
    availability: availability.toLowerCase(),
    quantity,
    inventoryConfidenceBps,
    observedPriceCents,
    observedAt: new Date(observedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    verificationMethod: verificationMethod.toLowerCase(),
    provenanceHash: provenanceHash.toLowerCase(),
    sourceHealth: sourceHealth.toLowerCase(),
  };
}

function sameEvidence(left: InventoryEvidenceV1, right: InventoryEvidenceV1) {
  return (
    left.version === right.version && left.supplierOfferId === right.supplierOfferId &&
    left.idempotencyKey === right.idempotencyKey && left.availability === right.availability &&
    left.quantity === right.quantity && left.inventoryConfidenceBps === right.inventoryConfidenceBps &&
    left.observedPriceCents === right.observedPriceCents && left.observedAt === right.observedAt &&
    left.expiresAt === right.expiresAt && left.verificationMethod === right.verificationMethod &&
    left.provenanceHash === right.provenanceHash && left.sourceHealth === right.sourceHealth
  );
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
  if (observation.observedPriceCents !== null && observation.observedPriceCents !== undefined && observation.observedPriceCents !== expected.itemCostCents) reasons.push("observed_supplier_price_drift");
  const evidence = buildEvidence(observation);
  if (!evidence) reasons.push("inventory_evidence_unserializable");
  return { allowed: reasons.length === 0, reasons, evidence };
}

export function evaluateSpecificationsInventoryEvidenceBinding(
  specifications: string,
  observation: InventoryObservationSnapshot | null | undefined,
  expected: { supplierOfferId: string; itemCostCents: number },
  nowMs = Date.now(),
): InventoryEvidenceDecision {
  const current = evaluateInventoryEvidenceBinding(observation, expected, nowMs);
  const reasons = [...current.reasons];
  let bound: InventoryEvidenceV1 | null = null;
  let persistedOfferId: string | null = null;
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const rawOffer = root.supplierOfferV1;
    if (rawOffer && typeof rawOffer === "object" && !Array.isArray(rawOffer)) {
      const offer = rawOffer as Record<string, unknown>;
      persistedOfferId = safeString(offer.persistedOfferId, 128);
      bound = normalizeEvidence(offer.inventoryEvidenceV1);
    }
  } catch {
    // The supplier snapshot validator reports malformed product metadata separately.
  }

  if (persistedOfferId && persistedOfferId !== expected.supplierOfferId) reasons.push("inventory_bound_offer_mismatch");
  if (!bound) {
    if (inventoryEvidenceBindingRequired()) reasons.push("inventory_bound_evidence_missing_or_invalid");
  } else if (!current.evidence || !sameEvidence(bound, current.evidence)) {
    reasons.push("inventory_bound_evidence_drift");
  }

  const deduped = [...new Set(reasons)];
  return { allowed: deduped.length === 0, reasons: deduped, evidence: current.evidence };
}

export async function resolveCurrentInventoryEvidence(supplierOfferId: string, itemCostCents: number, nowMs = Date.now()) {
  const observation = await readLatestInventoryObservation(supplierOfferId);
  return evaluateInventoryEvidenceBinding(observation, { supplierOfferId, itemCostCents }, nowMs);
}

export function bindInventoryEvidenceToSpecifications(specifications: string, persistedOfferId: string, evidence: InventoryEvidenceV1) {
  const root = JSON.parse(specifications) as Record<string, unknown>;
  const raw = root.supplierOfferV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("COMMERCIALIZATION_SNAPSHOT_INVALID");
  const offer = raw as Record<string, unknown>;
  const boundOfferId = typeof offer.persistedOfferId === "string" ? offer.persistedOfferId : null;
  if (boundOfferId && boundOfferId !== persistedOfferId) throw new Error("INVENTORY_EVIDENCE_OFFER_MISMATCH");
  root.supplierOfferV1 = { ...offer, inventoryEvidenceV1: evidence };
  return JSON.stringify(root);
}

export function refreshBoundInventoryEvidence(specifications: string, persistedOfferId: string, evidence: InventoryEvidenceV1) {
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
