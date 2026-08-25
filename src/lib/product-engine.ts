import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { buildAmazonProductUrl } from "@/lib/affiliate/amazon-config";

export const ENGINE_WORKERS = ["scout-a", "scout-b", "validator", "classifier", "publisher"] as const;
export type EngineWorker = (typeof ENGINE_WORKERS)[number];

const ASIN_RE = /^[A-Z0-9]{10}$/;
const ALLOWED_SOURCE_TYPES = new Set(["owner_asin", "owner_special_link", "public_reference"]);
const MAX_TEXT = 5000;
const ENGINE_LEASE_MS = 5 * 60_000;
const ENGINE_LOCK_PREFIX = "__lock__:";
const RUN_LEASE_KEY = `${ENGINE_LOCK_PREFIX}run`;
const PUBLISHER_LEASE_KEY = `${ENGINE_LOCK_PREFIX}publisher`;

type EngineLease = {
  key: string;
  token: string;
  expiresAt: Date;
};

export type CandidateInput = {
  asin: string;
  sourceType: string;
  sourceUrl?: string | null;
  scout?: "scout-a" | "scout-b";
  title?: string | null;
  brand?: string | null;
  description?: string | null;
  images?: string[];
  category?: string | null;
  ownerSpecialLink?: string | null;
  variationKey?: string | null;
};

export function normalizeAsin(value: string) {
  return value.trim().toUpperCase();
}

export function isValidAsin(value: string) {
  return ASIN_RE.test(normalizeAsin(value));
}

function cleanText(value: string | null | undefined, max = MAX_TEXT) {
  if (!value) return null;
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("SOURCE_URL_SCHEME");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("SOURCE_URL_PRIVATE_HOST");
  return url.toString().slice(0, 2000);
}

function safeSpecialLink(value: string | null | undefined, asin: string) {
  if (!value) return null;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "amazon.com" || host.endsWith(".amazon.com") || host === "amzn.to")) {
    throw new Error("INVALID_AMAZON_SPECIAL_LINK");
  }
  if (host !== "amzn.to" && !url.pathname.toUpperCase().includes(asin)) throw new Error("SPECIAL_LINK_ASIN_MISMATCH");
  return url.toString().slice(0, 2000);
}

function safeImages(values: string[] | undefined) {
  if (!values) return [];
  return values.slice(0, 8).flatMap((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return [];
      return [url.toString().slice(0, 2000)];
    } catch {
      return [];
    }
  });
}

export function classifyCandidate(title = "", category = "") {
  const haystack = `${title} ${category}`.toLowerCase();
  const map: Array<[string, string[]]> = [
    ["electronics", ["electronics", "phone", "laptop", "tablet", "headphone", "charger", "camera"]],
    ["home-kitchen", ["kitchen", "home", "vacuum", "cookware", "bedding", "furniture"]],
    ["clothing", ["shirt", "dress", "clothing", "shoe", "jacket", "jean", "apparel"]],
    ["beauty", ["beauty", "skin", "makeup", "shampoo", "cosmetic"]],
    ["toys-games", ["toy", "game", "lego", "puzzle"]],
    ["sports-outdoors", ["sport", "outdoor", "camp", "fitness", "golf"]],
    ["baby", ["baby", "diaper", "infant", "toddler"]],
    ["books", ["book", "paperback", "hardcover", "kindle"]],
  ];
  for (const [slug, words] of map) if (words.some((word) => haystack.includes(word))) return slug;
  return cleanText(category, 100)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

export function scoreCandidate(input: { titleCandidate: string | null; brandCandidate: string | null; categoryCandidate: string | null; sourceType: string; ownerSpecialLink: string | null }) {
  let score = 35;
  if (input.titleCandidate && input.titleCandidate.length >= 8) score += 25;
  if (input.brandCandidate) score += 10;
  if (input.categoryCandidate) score += 15;
  if (input.sourceType === "owner_special_link" && input.ownerSpecialLink) score += 15;
  else if (input.sourceType === "owner_asin") score += 10;
  else if (input.sourceType === "public_reference") score += 5;
  return Math.min(100, score);
}

function idempotencyKey(asin: string, sourceType: string) {
  return createHash("sha256").update(`product-engine:v1:${asin}:${sourceType}`).digest("hex");
}

async function audit(candidateId: string | null, actor: string, action: string, fromState?: string | null, toState?: string | null, detail: Record<string, unknown> = {}) {
  await prisma.productEngineAudit.create({ data: { candidateId, actor, action, fromState: fromState ?? null, toState: toState ?? null, detail: JSON.stringify(detail) } });
}

function leaseStatus(token: string) {
  return `lease:${token}`;
}

function candidateLeaseKey(id: string) {
  return `${ENGINE_LOCK_PREFIX}candidate:${id}`;
}

async function acquireEngineLease(key: string, ttlMs = ENGINE_LEASE_MS): Promise<EngineLease | null> {
  const now = new Date();
  await prisma.productEngineWorkerState.upsert({
    where: { worker: key },
    create: { worker: key, status: "idle", healthy: true },
    update: {},
  });

  const token = randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const claimed = await prisma.productEngineWorkerState.updateMany({
    where: {
      worker: key,
      OR: [
        { status: "idle" },
        { lastHeartbeatAt: null },
        { lastHeartbeatAt: { lte: now } },
      ],
    },
    data: {
      status: leaseStatus(token),
      healthy: true,
      lastHeartbeatAt: expiresAt,
      lastRunAt: now,
      lastError: null,
    },
  });

  return claimed.count === 1 ? { key, token, expiresAt } : null;
}

async function tryRenewEngineLease(lease: EngineLease, ttlMs = ENGINE_LEASE_MS) {
  const expiresAt = new Date(Date.now() + ttlMs);
  const renewed = await prisma.productEngineWorkerState.updateMany({
    where: { worker: lease.key, status: leaseStatus(lease.token) },
    data: { lastHeartbeatAt: expiresAt },
  });
  if (renewed.count === 1) lease.expiresAt = expiresAt;
  return renewed.count === 1;
}

async function renewEngineLease(lease: EngineLease, ttlMs = ENGINE_LEASE_MS) {
  if (!(await tryRenewEngineLease(lease, ttlMs))) throw new Error("ENGINE_LEASE_LOST");
}

async function releaseEngineLease(lease: EngineLease) {
  await prisma.productEngineWorkerState.deleteMany({
    where: { worker: lease.key, status: leaseStatus(lease.token) },
  });
}

function leaseLost(error: unknown) {
  return error instanceof Error && error.message === "ENGINE_LEASE_LOST";
}

export async function getEngineConfig() {
  return prisma.productEngineConfig.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
}

export async function setEnginePaused(paused: boolean, actor: string) {
  const config = await prisma.productEngineConfig.upsert({ where: { id: "default" }, create: { id: "default", paused }, update: { paused } });
  await audit(null, actor, paused ? "engine_paused" : "engine_resumed", null, null, { paused });
  return config;
}

export async function ingestCandidate(raw: CandidateInput, actor: string) {
  const asin = normalizeAsin(raw.asin);
  if (!isValidAsin(asin)) throw new Error("INVALID_ASIN");
  if (!ALLOWED_SOURCE_TYPES.has(raw.sourceType)) throw new Error("INVALID_SOURCE_TYPE");
  const scout = raw.scout === "scout-b" ? "scout-b" : "scout-a";
  const sourceUrl = safeSourceUrl(raw.sourceUrl);
  const special = safeSpecialLink(raw.ownerSpecialLink, asin);
  const title = cleanText(raw.title, 500);
  const brand = cleanText(raw.brand, 160);
  const description = cleanText(raw.description);
  const category = cleanText(raw.category, 100);
  const variationKey = cleanText(raw.variationKey, 160)?.toLowerCase() ?? null;
  const images = safeImages(raw.images);
  const key = idempotencyKey(asin, raw.sourceType);

  const existing = await prisma.productCandidate.findUnique({ where: { asin } });
  if (existing) {
    await audit(existing.id, actor, "candidate_duplicate", existing.state, existing.state, { asin, scout });
    return { candidate: existing, duplicate: true };
  }

  try {
    const candidate = await prisma.productCandidate.create({
      data: {
        asin, idempotencyKey: key, sourceType: raw.sourceType, sourceUrl, scout,
        titleCandidate: title, brandCandidate: brand, descriptionCandidate: description,
        imagesCandidate: JSON.stringify(images), categoryCandidate: category, ownerSpecialLink: special,
        variationKey, state: "discovered",
      },
    });
    await audit(candidate.id, actor, "candidate_ingested", null, "discovered", { asin, scout, sourceType: raw.sourceType });
    await touchWorker(scout, true);
    return { candidate, duplicate: false };
  } catch (error) {
    const raced = await prisma.productCandidate.findUnique({ where: { asin } });
    if (raced) {
      await audit(raced.id, actor, "candidate_duplicate_race", raced.state, raced.state, { asin, scout });
      return { candidate: raced, duplicate: true };
    }
    throw error;
  }
}

async function touchWorker(worker: EngineWorker, success: boolean, error?: string) {
  const now = new Date();
  await prisma.productEngineWorkerState.upsert({
    where: { worker },
    create: { worker, status: "idle", healthy: success, lastHeartbeatAt: now, lastRunAt: now, lastSuccessAt: success ? now : null, processedCount: success ? 1 : 0, errorCount: success ? 0 : 1, lastError: error ?? null },
    update: { status: "idle", healthy: success, lastHeartbeatAt: now, lastRunAt: now, lastSuccessAt: success ? now : undefined, processedCount: success ? { increment: 1 } : undefined, errorCount: success ? undefined : { increment: 1 }, lastError: error ?? null },
  });
}

async function transition(id: string, actor: string, fromState: string, toState: string, data: Record<string, unknown> = {}, lease?: EngineLease) {
  if (lease) await renewEngineLease(lease);
  const candidate = await prisma.productCandidate.update({ where: { id }, data: { state: toState, ...data } });
  await audit(id, actor, "state_transition", fromState, toState, data);
  return candidate;
}

async function retryOrDeadLetter(candidate: { id: string; state: string; attemptCount: number; maxAttempts: number }, worker: EngineWorker, error: unknown, lease?: EngineLease) {
  if (lease) await renewEngineLease(lease);
  const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown pipeline error";
  const attempts = candidate.attemptCount + 1;
  const dead = attempts >= candidate.maxAttempts;
  const nextAttemptAt = dead ? null : new Date(Date.now() + Math.min(3600000, 1000 * 2 ** attempts));
  await prisma.productCandidate.update({ where: { id: candidate.id }, data: { attemptCount: attempts, lastError: message, nextAttemptAt, state: dead ? "dead_letter" : candidate.state, deadLetteredAt: dead ? new Date() : null } });
  await audit(candidate.id, worker, dead ? "dead_lettered" : "retry_scheduled", candidate.state, dead ? "dead_letter" : candidate.state, { attempts, message, nextAttemptAt });
  await touchWorker(worker, false, message);
}

export async function validateCandidate(id: string) {
  const config = await getEngineConfig();
  if (config.paused) return { paused: true } as const;
  let candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  if (!["discovered", "validating"].includes(candidate.state)) return candidate;

  const lease = await acquireEngineLease(candidateLeaseKey(id));
  if (!lease) {
    await audit(id, "validator", "candidate_stage_busy", candidate.state, candidate.state, { stage: "validator" });
    return prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  }

  try {
    candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
    if (!["discovered", "validating"].includes(candidate.state)) return candidate;
    if ((await getEngineConfig()).paused) return { paused: true } as const;

    await transition(id, "validator", candidate.state, "validating", {}, lease);
    const score = scoreCandidate(candidate);
    const reasons: string[] = [];
    if (!isValidAsin(candidate.asin)) reasons.push("invalid_asin");
    if (!ALLOWED_SOURCE_TYPES.has(candidate.sourceType)) reasons.push("invalid_source");
    if (!candidate.titleCandidate) reasons.push("missing_title");
    if (!candidate.categoryCandidate) reasons.push("missing_category");
    if (candidate.variationKey) {
      await renewEngineLease(lease);
      const variationCount = await prisma.productCandidate.count({ where: { variationKey: candidate.variationKey, state: { notIn: ["rejected", "dead_letter"] } } });
      if (variationCount > config.maxVariations) reasons.push("variation_spam");
    }
    if (score < config.acceptanceThreshold) reasons.push("below_threshold");
    if (reasons.length) {
      const rejected = await transition(id, "validator", "validating", "rejected", { validationResult: "rejected", validationDetail: JSON.stringify({ reasons }), rejectionReason: reasons.join(","), score }, lease);
      await touchWorker("validator", true);
      return rejected;
    }
    const validated = await transition(id, "validator", "validating", "validated", { validationResult: "accepted", validationDetail: JSON.stringify({ reasons: [] }), score, rejectionReason: null }, lease);
    await touchWorker("validator", true);
    return validated;
  } catch (error) {
    if (!leaseLost(error) && await tryRenewEngineLease(lease)) {
      await retryOrDeadLetter(candidate, "validator", error, lease);
    }
    throw error;
  } finally {
    await releaseEngineLease(lease);
  }
}

export async function classifyOne(id: string) {
  const config = await getEngineConfig();
  if (config.paused) return { paused: true } as const;
  let candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  if (candidate.state !== "validated") return candidate;

  const lease = await acquireEngineLease(candidateLeaseKey(id));
  if (!lease) {
    await audit(id, "classifier", "candidate_stage_busy", candidate.state, candidate.state, { stage: "classifier" });
    return prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  }

  try {
    candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
    if (candidate.state !== "validated") return candidate;
    if ((await getEngineConfig()).paused) return { paused: true } as const;

    const normalizedCategory = classifyCandidate(candidate.titleCandidate ?? "", candidate.categoryCandidate ?? "");
    const classification = JSON.stringify({ category: normalizedCategory, version: 1 });
    const classified = await transition(id, "classifier", "validated", "classified", { normalizedCategory, classification }, lease);
    await touchWorker("classifier", true);
    return classified;
  } catch (error) {
    if (!leaseLost(error) && await tryRenewEngineLease(lease)) {
      await retryOrDeadLetter(candidate, "classifier", error, lease);
    }
    throw error;
  } finally {
    await releaseEngineLease(lease);
  }
}

function parseImages(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, 8) : [];
  } catch { return []; }
}

export async function publishCandidate(id: string, actor = "publisher") {
  const config = await getEngineConfig();
  if (config.paused) return { paused: true } as const;
  let candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  if (!["classified", "approved"].includes(candidate.state)) return candidate;

  const candidateLease = await acquireEngineLease(candidateLeaseKey(id));
  if (!candidateLease) {
    await audit(id, actor, "candidate_stage_busy", candidate.state, candidate.state, { stage: "publisher" });
    return prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  }

  let publisherLease: EngineLease | null = null;
  try {
    candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
    if (!["classified", "approved"].includes(candidate.state)) return candidate;

    publisherLease = await acquireEngineLease(PUBLISHER_LEASE_KEY);
    if (!publisherLease) {
      await audit(id, actor, "publisher_single_writer_busy", candidate.state, candidate.state);
      return candidate;
    }
    if ((await getEngineConfig()).paused) return { paused: true } as const;

    await renewEngineLease(candidateLease);
    await renewEngineLease(publisherLease);
    if (!candidate.normalizedCategory || !candidate.titleCandidate) throw new Error("PUBLISH_METADATA_INCOMPLETE");
    const category = await prisma.category.findUnique({ where: { slug: candidate.normalizedCategory } });
    if (!category) {
      const rejected = await transition(id, actor, candidate.state, "rejected", { rejectionReason: "unknown_category" }, candidateLease);
      await touchWorker("publisher", true);
      return rejected;
    }

    await renewEngineLease(publisherLease);
    const publishedInCategory = await prisma.productCandidate.count({ where: { normalizedCategory: candidate.normalizedCategory, state: "published" } });
    if (publishedInCategory >= config.categoryQuota) {
      const rejected = await transition(id, actor, candidate.state, "rejected", { rejectionReason: "category_quota" }, candidateLease);
      await touchWorker("publisher", true);
      return rejected;
    }

    await renewEngineLease(candidateLease);
    await renewEngineLease(publisherLease);
    const existingProduct = await prisma.product.findFirst({ where: { asin: candidate.asin, retailer: "amazon" } });
    const images = parseImages(candidate.imagesCandidate);
    const product = existingProduct ?? await prisma.product.create({
      data: {
        asin: candidate.asin,
        slug: `amazon-${candidate.asin.toLowerCase()}`,
        title: candidate.titleCandidate,
        description: candidate.descriptionCandidate ?? candidate.titleCandidate,
        brand: candidate.brandCandidate ?? "Amazon",
        categoryId: category.id,
        images: JSON.stringify(images.length ? images : ["/images/placeholder-product.svg"]),
        price: 0,
        originalPrice: 0,
        discountPercent: 0,
        rating: 0,
        reviewCount: 0,
        affiliateUrl: candidate.ownerSpecialLink ?? buildAmazonProductUrl(candidate.asin),
        retailer: "amazon",
        availability: "unknown",
        specifications: JSON.stringify({ productEngine: true, sourceType: candidate.sourceType }),
        priceSource: null,
        priceVerifiedAt: null,
        metadataSource: candidate.sourceType,
        metadataVerifiedAt: null,
      },
    });

    await renewEngineLease(publisherLease);
    const published = await transition(id, actor, candidate.state, "published", { publishedProductId: product.id, publishedAt: new Date(), nextAttemptAt: null, lastError: null }, candidateLease);
    await prisma.productEngineConfig.update({ where: { id: "default" }, data: { lastPublishedAt: new Date() } });
    await touchWorker("publisher", true);
    return published;
  } catch (error) {
    if (!leaseLost(error) && await tryRenewEngineLease(candidateLease)) {
      await retryOrDeadLetter(candidate, "publisher", error, candidateLease);
    }
    throw error;
  } finally {
    if (publisherLease) await releaseEngineLease(publisherLease);
    await releaseEngineLease(candidateLease);
  }
}

export async function runProductEngine(actor = "owner") {
  const initialConfig = await getEngineConfig();
  if (initialConfig.paused) return { paused: true, processed: 0, busy: false };

  const runLease = await acquireEngineLease(RUN_LEASE_KEY);
  if (!runLease) {
    await audit(null, actor, "engine_run_skipped_busy", null, null);
    return { paused: false, processed: 0, busy: true };
  }

  try {
    const config = await getEngineConfig();
    if (config.paused) return { paused: true, processed: 0, busy: false };
    await prisma.productEngineConfig.update({ where: { id: "default" }, data: { lastRunAt: new Date() } });
    for (const scout of ["scout-a", "scout-b"] as const) await touchWorker(scout, true);
    const due = await prisma.productCandidate.findMany({
      where: { state: { in: ["discovered", "validating", "validated", "classified", "approved"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: { createdAt: "asc" },
      take: Math.min(50, Math.max(1, config.maxConcurrency * 5)),
    });
    const concurrency = Math.min(10, Math.max(1, config.maxConcurrency));
    for (let i = 0; i < due.length; i += concurrency) {
      await renewEngineLease(runLease);
      if ((await getEngineConfig()).paused) break;
      await Promise.all(due.slice(i, i + concurrency).map(async (row) => {
        try {
          let current = await prisma.productCandidate.findUniqueOrThrow({ where: { id: row.id } });
          if (["discovered", "validating"].includes(current.state)) await validateCandidate(current.id);
          current = await prisma.productCandidate.findUniqueOrThrow({ where: { id: row.id } });
          if (current.state === "validated") await classifyOne(current.id);
          current = await prisma.productCandidate.findUniqueOrThrow({ where: { id: row.id } });
          if (["classified", "approved"].includes(current.state)) await publishCandidate(current.id);
        } catch {
          // Stage-specific retry/dead-letter handling already recorded the failure.
        }
      }));
    }
    await audit(null, actor, "engine_run_completed", null, null, { discovered: due.length });
    return { paused: false, processed: due.length, busy: false };
  } finally {
    await releaseEngineLease(runLease);
  }
}

export async function retryCandidate(id: string, actor: string) {
  const candidate = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
  if (!["dead_letter", "rejected"].includes(candidate.state)) throw new Error("NOT_RETRYABLE");

  const lease = await acquireEngineLease(candidateLeaseKey(id));
  if (!lease) throw new Error("CANDIDATE_BUSY");
  try {
    const current = await prisma.productCandidate.findUniqueOrThrow({ where: { id } });
    if (!["dead_letter", "rejected"].includes(current.state)) throw new Error("NOT_RETRYABLE");
    await renewEngineLease(lease);
    const next = await prisma.productCandidate.update({ where: { id }, data: { state: "discovered", validationResult: "pending", rejectionReason: null, lastError: null, deadLetteredAt: null, nextAttemptAt: null, attemptCount: 0 } });
    await audit(id, actor, "candidate_retried", current.state, "discovered");
    return next;
  } finally {
    await releaseEngineLease(lease);
  }
}

export async function productEngineDashboard() {
  const [config, workers, candidates, audits] = await Promise.all([
    getEngineConfig(),
    prisma.productEngineWorkerState.findMany({ where: { worker: { in: [...ENGINE_WORKERS] } }, orderBy: { worker: "asc" } }),
    prisma.productCandidate.findMany({ orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.productEngineAudit.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const counts: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  let duplicates = 0;
  for (const row of candidates) {
    counts[row.state] = (counts[row.state] ?? 0) + 1;
    if (row.normalizedCategory) categories[row.normalizedCategory] = (categories[row.normalizedCategory] ?? 0) + 1;
    if (row.rejectionReason) rejectionReasons[row.rejectionReason] = (rejectionReasons[row.rejectionReason] ?? 0) + 1;
  }
  duplicates = audits.filter((a) => a.action === "candidate_duplicate" || a.action === "candidate_duplicate_race").length;
  return { config, workers, candidates: candidates.slice(0, 100), audits, counts, categories, rejectionReasons, duplicates };
}
