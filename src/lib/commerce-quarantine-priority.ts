import type { CommerceQuarantineRecord } from "@/lib/commerce-quarantine";

export type QuarantinePriorityProduct = {
  id: string;
  sellingPriceCents: number | null;
  viewCount: number;
  clickCount: number;
  trendingScore: number;
  availability: string;
};

export type QuarantinePriority = {
  score: number;
  band: "critical" | "high" | "medium" | "low";
  reasonRiskScore: number;
  ageScore: number;
  demandScore: number;
  valueScore: number;
  estimatedExposureScore: number;
  blockedDurationMs: number;
  primaryReason: string;
};

const REASON_RISK: Record<string, number> = {
  tax_classification_missing_or_invalid: 100,
  tax_classification_verification_invalid: 95,
  source_verification_invalid: 100,
  supplier_not_eligible: 100,
  source_class_not_direct_resale: 100,
  resale_not_verified: 100,
  commercial_policy_missing_or_invalid: 95,
  supplier_cost_verification_invalid: 90,
  observed_supplier_price_drift: 90,
  landed_cost_invalid: 90,
  selling_price_invalid: 85,
  contribution_profit_below_floor: 90,
  contribution_margin_below_floor: 90,
  inventory_not_in_stock: 80,
  inventory_out_of_stock: 80,
  inventory_missing: 75,
  inventory_observation_missing: 75,
  inventory_confidence_below_floor: 70,
  inventory_confidence_low: 70,
  tax_classification_stale: 65,
  source_verification_stale: 65,
  supplier_cost_verification_stale: 65,
  inventory_stale: 60,
  inventory_observation_stale: 60,
  inventory_not_current: 60,
  inventory_observation_invalid: 70,
  safety_evidence_requires_review: 80,
};

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function reasonRisk(reasons: string[]) {
  if (!reasons.length) return { score: 80, primaryReason: "safety_evidence_requires_review" };
  let primaryReason = reasons[0];
  let score = REASON_RISK[primaryReason] ?? 80;
  for (const reason of reasons.slice(1)) {
    const candidate = REASON_RISK[reason] ?? 80;
    if (candidate > score) {
      score = candidate;
      primaryReason = reason;
    }
  }
  return { score, primaryReason };
}

export function calculateQuarantinePriority(
  record: CommerceQuarantineRecord,
  product: QuarantinePriorityProduct,
  now = new Date(),
): QuarantinePriority {
  const blockedDurationMs = Math.max(0, now.getTime() - record.quarantinedAt.getTime());
  const blockedHours = blockedDurationMs / 3_600_000;
  const risk = reasonRisk(record.reasons);

  // Age intentionally saturates after seven days so old records do not drown out safety severity.
  const ageScore = Math.round(clamp(blockedHours / (24 * 7), 0, 1) * 100);

  // Demand is a bounded owner-triage heuristic, not a revenue forecast.
  const views = finiteNonNegative(product.viewCount);
  const clicks = finiteNonNegative(product.clickCount);
  const trend = finiteNonNegative(product.trendingScore);
  const demandRaw = Math.log1p(views) * 9 + Math.log1p(clicks) * 15 + Math.min(trend, 100) * 0.35;
  const demandScore = Math.round(clamp(demandRaw, 0, 100));

  const sellingPriceCents = product.sellingPriceCents && product.sellingPriceCents > 0 ? product.sellingPriceCents : 0;
  const valueScore = Math.round(clamp(Math.log10(1 + sellingPriceCents / 100) * 35, 0, 100));
  const estimatedExposureScore = Math.round(demandScore * 0.7 + valueScore * 0.3);

  // Safety severity dominates. Age and exposure only order products within the blocked owner queue.
  const score = Math.round(
    clamp(
      risk.score * 6 +
        ageScore * 1.5 +
        estimatedExposureScore * 2.5 +
        Math.min(Math.max(record.reasons.length - 1, 0), 4) * 12,
      0,
      1000,
    ),
  );

  const band = score >= 850 ? "critical" : score >= 700 ? "high" : score >= 500 ? "medium" : "low";

  return {
    score,
    band,
    reasonRiskScore: risk.score,
    ageScore,
    demandScore,
    valueScore,
    estimatedExposureScore,
    blockedDurationMs,
    primaryReason: risk.primaryReason,
  };
}

export function rankQuarantineRecoveryQueue(
  records: CommerceQuarantineRecord[],
  products: QuarantinePriorityProduct[],
  now = new Date(),
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return records
    .map((record) => {
      const product = productById.get(record.productId);
      return product ? { record, product, priority: calculateQuarantinePriority(record, product, now) } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.priority.score - a.priority.score || a.record.quarantinedAt.getTime() - b.record.quarantinedAt.getTime());
}
