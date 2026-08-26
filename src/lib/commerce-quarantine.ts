export type CommerceQuarantineAudit = {
  id: string;
  action: string;
  detail: string;
  createdAt: Date;
};

export type CommerceQuarantineRecord = {
  auditId: string;
  productId: string;
  action: string;
  reasons: string[];
  quarantinedAt: Date;
  recoverySteps: string[];
};

export type CommerceQuarantineResolution = {
  auditId: string;
  productId: string;
  quarantineAuditId: string;
  quarantineReasons: string[];
  quarantinedAt: Date | null;
  resolvedAt: Date;
  blockedDurationMs: number | null;
  detail: Record<string, unknown>;
};

export const COMMERCE_QUARANTINE_ACTIONS = ["commerce_auto_paused", "inventory_product_demoted"] as const;
export const COMMERCE_QUARANTINE_RESOLUTION_ACTION = "commerce_quarantine_resolved";

const RECOVERY_GUIDANCE: Record<string, string> = {
  tax_classification_missing_or_invalid: "Review and save a valid product tax classification and Stripe product tax code.",
  tax_classification_verification_invalid: "Re-verify the product tax classification using a current, authoritative source.",
  tax_classification_stale: "Refresh the product tax classification evidence and verification timestamp.",
  source_verification_invalid: "Re-verify supplier resale authorization and source provenance.",
  source_verification_stale: "Refresh supplier resale/source verification before commercialization.",
  supplier_cost_verification_invalid: "Re-verify the supplier price and persist a current cost timestamp.",
  supplier_cost_verification_stale: "Refresh supplier price evidence and rerun landed-cost validation.",
  product_price_verification_drift: "Re-commercialize from the authoritative persisted supplier offer so the Product price provenance timestamp exactly matches supplier cost evidence.",
  inventory_missing: "Record a fresh trusted inventory observation for the selected supplier offer.",
  inventory_stale: "Refresh the supplier inventory observation before re-commercialization.",
  inventory_not_current: "Obtain a current supplier inventory observation before re-commercialization.",
  inventory_not_in_stock: "Confirm the supplier offer is actually in stock before re-commercialization.",
  inventory_confidence_below_floor: "Obtain higher-confidence inventory evidence before re-commercialization.",
  supplier_not_eligible: "Restore verified supplier eligibility and resale authorization before re-commercialization.",
  observed_supplier_price_drift: "Re-verify supplier cost, recalculate landed cost, and rerun the profit gate.",
  selling_price_invalid: "Set a valid selling price and rerun the pricing/profit gate.",
  landed_cost_invalid: "Recalculate and persist a complete landed cost before re-commercialization.",
  contribution_profit_below_floor: "Find a cheaper source or adjust the customer-friendly price without violating the minimum safe profit floor.",
  contribution_margin_below_floor: "Find a cheaper source or adjust pricing so the minimum contribution margin is restored.",
  commercial_policy_missing_or_invalid: "Rebuild the complete commercialization evidence bundle before enabling commerce.",
  source_class_not_direct_resale: "Use a verified direct-resale supplier class or keep the product non-commerce.",
  resale_not_verified: "Verify that resale is permitted for the selected supplier before re-commercialization.",
  inventory_observation_missing: "Record a fresh trusted inventory observation for the selected supplier offer.",
  inventory_observation_stale: "Refresh the supplier inventory observation before re-commercialization.",
  inventory_observation_invalid: "Replace invalid inventory evidence with a fresh trusted observation.",
  inventory_confidence_low: "Obtain higher-confidence inventory evidence before re-commercialization.",
  inventory_out_of_stock: "Confirm the supplier offer is back in stock before re-commercialization.",
};

function parseDetail(detail: string) {
  try {
    const value = JSON.parse(detail) as Record<string, unknown>;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))];
}

function parsedDate(value: unknown) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function quarantineResolutionAuditId(quarantineAuditId: string) {
  return `quarantine-resolution:${quarantineAuditId}`;
}

export function recoveryStepsForReasons(reasons: string[]) {
  const steps = reasons.map((reason) => RECOVERY_GUIDANCE[reason] ?? `Resolve safety condition: ${reason.replaceAll("_", " ")}.`);
  steps.push("Rerun the owner commercialization gate with fresh evidence. DealForge will not auto-resume the product.");
  return [...new Set(steps)];
}

export function deriveCommerceQuarantineResolutions(audits: CommerceQuarantineAudit[]) {
  const resolutions: CommerceQuarantineResolution[] = [];
  for (const audit of audits) {
    if (audit.action !== COMMERCE_QUARANTINE_RESOLUTION_ACTION) continue;
    const detail = parseDetail(audit.detail);
    const productId = typeof detail?.productId === "string" ? detail.productId.trim() : "";
    const quarantineAuditId = typeof detail?.quarantineAuditId === "string" ? detail.quarantineAuditId.trim() : "";
    if (!productId || !quarantineAuditId) continue;
    const quarantinedAt = parsedDate(detail?.quarantinedAt);
    const resolvedAt = parsedDate(detail?.resolvedAt) ?? audit.createdAt;
    const blockedDurationMs = typeof detail?.blockedDurationMs === "number" && Number.isSafeInteger(detail.blockedDurationMs) && detail.blockedDurationMs >= 0
      ? detail.blockedDurationMs
      : quarantinedAt
        ? Math.max(0, resolvedAt.getTime() - quarantinedAt.getTime())
        : null;
    resolutions.push({
      auditId: audit.id,
      productId,
      quarantineAuditId,
      quarantineReasons: uniqueStrings(detail?.quarantineReasons),
      quarantinedAt,
      resolvedAt,
      blockedDurationMs,
      detail: detail ?? {},
    });
  }
  return resolutions;
}

export function deriveCommerceQuarantineRecords(audits: CommerceQuarantineAudit[]) {
  const resolved = new Set(deriveCommerceQuarantineResolutions(audits).map((entry) => entry.quarantineAuditId));
  const seen = new Set<string>();
  const records: CommerceQuarantineRecord[] = [];

  for (const audit of audits) {
    if (!COMMERCE_QUARANTINE_ACTIONS.includes(audit.action as (typeof COMMERCE_QUARANTINE_ACTIONS)[number])) continue;
    if (resolved.has(audit.id)) continue;
    const detail = parseDetail(audit.detail);
    const productId = typeof detail?.productId === "string" ? detail.productId.trim() : "";
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const reasons = uniqueStrings(detail?.reasons);
    records.push({
      auditId: audit.id,
      productId,
      action: audit.action,
      reasons: reasons.length ? reasons : ["safety_evidence_requires_review"],
      quarantinedAt: audit.createdAt,
      recoverySteps: recoveryStepsForReasons(reasons.length ? reasons : ["safety_evidence_requires_review"]),
    });
  }

  return records;
}
