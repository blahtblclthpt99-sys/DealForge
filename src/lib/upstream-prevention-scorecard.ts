import type { QuarantineReasonMetric } from "@/lib/commerce-quarantine-analytics";

export type PreventionDomain = "tax" | "supplier" | "inventory" | "cost_profit" | "policy" | "other";

export type PreventionScorecardEntry = {
  domain: PreventionDomain;
  score: number;
  band: "critical" | "high" | "medium" | "low";
  events: number;
  open: number;
  medianResolvedDurationMs: number | null;
  reasons: string[];
  recommendation: string;
};

const DAY_MS = 86_400_000;

function domainForReason(reason: string): PreventionDomain {
  if (reason.startsWith("tax_")) return "tax";
  if (reason.includes("supplier") || reason.includes("source_") || reason.includes("resale")) return "supplier";
  if (reason.includes("inventory")) return "inventory";
  if (reason.includes("cost") || reason.includes("profit") || reason.includes("margin") || reason.includes("selling_price") || reason.includes("price_drift") || reason.includes("landed_cost")) return "cost_profit";
  if (reason.includes("commercial_policy") || reason.includes("safety_evidence")) return "policy";
  return "other";
}

const RECOMMENDATIONS: Record<PreventionDomain, string> = {
  tax: "Strengthen product tax classification before commercialization: require current authoritative classification evidence and reject stale tax metadata earlier.",
  supplier: "Strengthen supplier/source validation before commercialization: require resale authority, eligible source class, and current supplier verification before pricing.",
  inventory: "Strengthen inventory intake before commercialization: require a fresh trusted in-stock observation with confidence above the minimum floor.",
  cost_profit: "Strengthen economics before commercialization: refresh supplier cost, recalculate landed cost, and enforce minimum safe profit before publication.",
  policy: "Strengthen the complete commercialization bundle before publication so partially evidenced products remain parked instead of becoming commerce-ready.",
  other: "Review this recurring quarantine reason and add a deterministic pre-publication validation only after its evidence contract is understood.",
};

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function buildUpstreamPreventionScorecard(reasons: QuarantineReasonMetric[]) {
  const grouped = new Map<PreventionDomain, { events: number; open: number; durations: number[]; reasons: string[] }>();
  for (const metric of reasons) {
    const domain = domainForReason(metric.reason);
    const group = grouped.get(domain) ?? { events: 0, open: 0, durations: [], reasons: [] };
    group.events += metric.events;
    group.open += metric.open;
    if (metric.medianResolvedDurationMs !== null) group.durations.push(metric.medianResolvedDurationMs);
    group.reasons.push(metric.reason);
    grouped.set(domain, group);
  }

  return [...grouped.entries()].map(([domain, group]) => {
    const duration = median(group.durations);
    const eventScore = Math.min(55, group.events * 8);
    const openScore = Math.min(25, group.open * 10);
    const downtimeScore = duration === null ? 0 : Math.min(20, Math.round((duration / (7 * DAY_MS)) * 20));
    const score = Math.min(100, eventScore + openScore + downtimeScore);
    const band = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
    return {
      domain,
      score,
      band,
      events: group.events,
      open: group.open,
      medianResolvedDurationMs: duration,
      reasons: [...new Set(group.reasons)].sort(),
      recommendation: RECOMMENDATIONS[domain],
    } satisfies PreventionScorecardEntry;
  }).sort((a, b) => b.score - a.score || b.events - a.events || a.domain.localeCompare(b.domain));
}
