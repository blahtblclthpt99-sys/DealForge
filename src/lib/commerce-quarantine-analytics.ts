import type { CommerceQuarantineAudit, CommerceQuarantineResolution } from "@/lib/commerce-quarantine";
import {
  COMMERCE_QUARANTINE_ACTIONS,
  deriveCommerceQuarantineResolutions,
} from "@/lib/commerce-quarantine";

export type QuarantineEpisode = {
  auditId: string;
  productId: string;
  reasons: string[];
  quarantinedAt: Date;
  resolvedAt: Date | null;
  blockedDurationMs: number | null;
};

export type QuarantineReasonMetric = {
  reason: string;
  events: number;
  resolved: number;
  open: number;
  medianResolvedDurationMs: number | null;
};

export type QuarantineProductMetric = {
  productId: string;
  events: number;
  resolved: number;
  open: number;
  totalResolvedDowntimeMs: number;
  medianResolvedDurationMs: number | null;
  latestQuarantineAt: Date;
};

export type QuarantinePerformanceAnalytics = {
  totalEvents: number;
  resolvedEvents: number;
  openEvents: number;
  recoveryRatePct: number | null;
  medianResolvedDurationMs: number | null;
  recent7dEvents: number;
  prior7dEvents: number;
  sevenDayDeltaPct: number | null;
  repeatProductCount: number;
  reasons: QuarantineReasonMetric[];
  products: QuarantineProductMetric[];
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

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function resolutionByQuarantineAuditId(resolutions: CommerceQuarantineResolution[]) {
  return new Map(resolutions.map((resolution) => [resolution.quarantineAuditId, resolution]));
}

export function deriveQuarantineEpisodes(audits: CommerceQuarantineAudit[]) {
  const resolutions = deriveCommerceQuarantineResolutions(audits);
  const resolutionByAudit = resolutionByQuarantineAuditId(resolutions);
  const episodes: QuarantineEpisode[] = [];

  for (const audit of audits) {
    if (!COMMERCE_QUARANTINE_ACTIONS.includes(audit.action as (typeof COMMERCE_QUARANTINE_ACTIONS)[number])) continue;
    const detail = parseDetail(audit.detail);
    const productId = typeof detail?.productId === "string" ? detail.productId.trim() : "";
    if (!productId) continue;
    const resolution = resolutionByAudit.get(audit.id);
    const reasons = uniqueStrings(detail?.reasons);
    episodes.push({
      auditId: audit.id,
      productId,
      reasons: reasons.length ? reasons : ["safety_evidence_requires_review"],
      quarantinedAt: audit.createdAt,
      resolvedAt: resolution?.resolvedAt ?? null,
      blockedDurationMs: resolution?.blockedDurationMs ?? null,
    });
  }

  return episodes.sort((a, b) => b.quarantinedAt.getTime() - a.quarantinedAt.getTime());
}

export function calculateQuarantinePerformanceAnalytics(
  audits: CommerceQuarantineAudit[],
  now = new Date(),
): QuarantinePerformanceAnalytics {
  const episodes = deriveQuarantineEpisodes(audits);
  const resolvedEpisodes = episodes.filter((episode) => episode.resolvedAt !== null);
  const resolvedDurations = resolvedEpisodes
    .map((episode) => episode.blockedDurationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

  const reasonMap = new Map<string, { events: number; resolved: number; durations: number[] }>();
  const productMap = new Map<string, { events: number; resolved: number; durations: number[]; latestQuarantineAt: Date }>();

  for (const episode of episodes) {
    for (const reason of episode.reasons) {
      const current = reasonMap.get(reason) ?? { events: 0, resolved: 0, durations: [] };
      current.events += 1;
      if (episode.resolvedAt) current.resolved += 1;
      if (episode.blockedDurationMs !== null) current.durations.push(episode.blockedDurationMs);
      reasonMap.set(reason, current);
    }

    const product = productMap.get(episode.productId) ?? {
      events: 0,
      resolved: 0,
      durations: [],
      latestQuarantineAt: episode.quarantinedAt,
    };
    product.events += 1;
    if (episode.resolvedAt) product.resolved += 1;
    if (episode.blockedDurationMs !== null) product.durations.push(episode.blockedDurationMs);
    if (episode.quarantinedAt > product.latestQuarantineAt) product.latestQuarantineAt = episode.quarantinedAt;
    productMap.set(episode.productId, product);
  }

  const reasons = [...reasonMap.entries()]
    .map(([reason, metric]) => ({
      reason,
      events: metric.events,
      resolved: metric.resolved,
      open: metric.events - metric.resolved,
      medianResolvedDurationMs: median(metric.durations),
    }))
    .sort((a, b) => b.events - a.events || b.open - a.open || a.reason.localeCompare(b.reason));

  const products = [...productMap.entries()]
    .map(([productId, metric]) => ({
      productId,
      events: metric.events,
      resolved: metric.resolved,
      open: metric.events - metric.resolved,
      totalResolvedDowntimeMs: metric.durations.reduce((sum, value) => sum + value, 0),
      medianResolvedDurationMs: median(metric.durations),
      latestQuarantineAt: metric.latestQuarantineAt,
    }))
    .sort((a, b) => b.events - a.events || b.open - a.open || b.totalResolvedDowntimeMs - a.totalResolvedDowntimeMs || b.latestQuarantineAt.getTime() - a.latestQuarantineAt.getTime());

  const nowMs = now.getTime();
  const dayMs = 86_400_000;
  const recent7dEvents = episodes.filter((episode) => episode.quarantinedAt.getTime() > nowMs - 7 * dayMs && episode.quarantinedAt.getTime() <= nowMs).length;
  const prior7dEvents = episodes.filter((episode) => episode.quarantinedAt.getTime() > nowMs - 14 * dayMs && episode.quarantinedAt.getTime() <= nowMs - 7 * dayMs).length;
  const sevenDayDeltaPct = prior7dEvents > 0
    ? Math.round(((recent7dEvents - prior7dEvents) / prior7dEvents) * 100)
    : recent7dEvents > 0
      ? 100
      : null;

  return {
    totalEvents: episodes.length,
    resolvedEvents: resolvedEpisodes.length,
    openEvents: episodes.length - resolvedEpisodes.length,
    recoveryRatePct: episodes.length ? Math.round((resolvedEpisodes.length / episodes.length) * 100) : null,
    medianResolvedDurationMs: median(resolvedDurations),
    recent7dEvents,
    prior7dEvents,
    sevenDayDeltaPct,
    repeatProductCount: products.filter((product) => product.events > 1).length,
    reasons,
    products,
  };
}
