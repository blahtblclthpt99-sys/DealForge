import { createHash } from "node:crypto";

export type InventoryFreshnessState = "current" | "aging" | "stale" | "unknown" | "paused";

export type InventoryObservationSnapshot = {
  supplierOfferId: string;
  availability: string;
  quantity?: number | null;
  inventoryConfidenceBps: number;
  observedPriceCents?: number | null;
  observedAt: Date | null;
  expiresAt: Date | null;
  verificationMethod?: string | null;
  provenance?: string | null;
  sourceHealth?: string | null;
};

export type InventoryFreshnessPolicy = {
  minInventoryConfidenceBps: number;
  requireCurrent?: boolean;
  agingFractionBps?: number;
};

export type InventoryFreshnessDecision = {
  state: InventoryFreshnessState;
  promotable: boolean;
  reasons: string[];
};

const DEFAULT_AGING_FRACTION_BPS = 7500;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const PAUSED_SOURCE_STATES = new Set(["paused", "disabled", "blocked", "degraded_hard"]);

function validBps(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000;
}

function validQuantity(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

export function evaluateInventoryFreshness(
  observation: InventoryObservationSnapshot | null | undefined,
  policy: InventoryFreshnessPolicy,
  nowMs = Date.now(),
): InventoryFreshnessDecision {
  const reasons: string[] = [];
  if (!observation) return { state: "unknown", promotable: false, reasons: ["inventory_observation_missing"] };

  const sourceHealth = observation.sourceHealth?.trim().toLowerCase() || "healthy";
  if (PAUSED_SOURCE_STATES.has(sourceHealth)) {
    return { state: "paused", promotable: false, reasons: ["inventory_source_paused"] };
  }

  if (!validBps(policy.minInventoryConfidenceBps)) reasons.push("inventory_confidence_policy_invalid");
  if (!validBps(observation.inventoryConfidenceBps)) reasons.push("inventory_confidence_invalid");
  if (!validQuantity(observation.quantity)) reasons.push("inventory_quantity_invalid");

  const observedAt = observation.observedAt?.getTime() ?? Number.NaN;
  const expiresAt = observation.expiresAt?.getTime() ?? Number.NaN;
  if (
    !Number.isFinite(observedAt) || !Number.isFinite(expiresAt) ||
    observedAt > nowMs + MAX_FUTURE_SKEW_MS || expiresAt <= observedAt
  ) {
    reasons.push("inventory_observation_invalid");
    return { state: "unknown", promotable: false, reasons };
  }

  if (nowMs >= expiresAt) {
    reasons.push("inventory_observation_stale");
    return { state: "stale", promotable: false, reasons };
  }

  const agingFractionBps = validBps(policy.agingFractionBps)
    ? policy.agingFractionBps
    : DEFAULT_AGING_FRACTION_BPS;
  const ttlMs = expiresAt - observedAt;
  const agingAt = observedAt + Math.floor((ttlMs * agingFractionBps) / 10_000);
  const state: InventoryFreshnessState = nowMs >= agingAt ? "aging" : "current";

  const availability = observation.availability.trim().toLowerCase();
  if (availability !== "in_stock") reasons.push("inventory_not_in_stock");
  if (observation.quantity === 0) reasons.push("inventory_quantity_zero");
  if (
    validBps(observation.inventoryConfidenceBps) && validBps(policy.minInventoryConfidenceBps) &&
    observation.inventoryConfidenceBps < policy.minInventoryConfidenceBps
  ) reasons.push("inventory_confidence_below_floor");
  if (policy.requireCurrent !== false && state !== "current") reasons.push("inventory_observation_aging");

  return { state, promotable: reasons.length === 0, reasons };
}

export function buildInventoryObservationIdempotencyKey(input: {
  supplierOfferId: string;
  observedAt: Date;
  availability: string;
  observedPriceCents?: number | null;
  quantity?: number | null;
  verificationMethod: string;
  provenance: string;
}) {
  const canonical = [
    input.supplierOfferId.trim(),
    input.observedAt.toISOString(),
    input.availability.trim().toLowerCase(),
    input.observedPriceCents ?? "null",
    input.quantity ?? "null",
    input.verificationMethod.trim().toLowerCase(),
    input.provenance.trim(),
  ].join("|");
  return `inventory_v1_${createHash("sha256").update(canonical).digest("hex")}`;
}
