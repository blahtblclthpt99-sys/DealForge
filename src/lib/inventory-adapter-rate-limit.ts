import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { resolveInventoryAdapterRuntimeValue, type InventoryAdapterIdentity } from "./inventory-adapter-auth";

export type InventoryAdapterRatePolicy = {
  windowSeconds: number;
  maxRequests: number;
  maxClaimUnits: number;
  maxClaimItems: number;
};

type RateWindowRow = {
  requestCount: number;
  claimUnits: number;
};

const DEFAULT_POLICY: InventoryAdapterRatePolicy = Object.freeze({
  windowSeconds: 60,
  maxRequests: 30,
  maxClaimUnits: 50,
  maxClaimItems: 5,
});

const LIMITS = {
  windowSeconds: [10, 3600],
  maxRequests: [1, 600],
  maxClaimUnits: [1, 1000],
  maxClaimItems: [1, 25],
} as const;

function boundedInt(value: unknown, field: keyof InventoryAdapterRatePolicy, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new Error("ADAPTER_RATE_LIMIT_CONFIG_INVALID");
  const [min, max] = LIMITS[field];
  if ((value as number) < min || (value as number) > max) throw new Error("ADAPTER_RATE_LIMIT_CONFIG_INVALID");
  return value as number;
}

function parsePolicy(raw: unknown, fallback: InventoryAdapterRatePolicy): InventoryAdapterRatePolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("ADAPTER_RATE_LIMIT_CONFIG_INVALID");
  const value = raw as Record<string, unknown>;
  return {
    windowSeconds: boundedInt(value.windowSeconds, "windowSeconds", fallback.windowSeconds),
    maxRequests: boundedInt(value.maxRequests, "maxRequests", fallback.maxRequests),
    maxClaimUnits: boundedInt(value.maxClaimUnits, "maxClaimUnits", fallback.maxClaimUnits),
    maxClaimItems: boundedInt(value.maxClaimItems, "maxClaimItems", fallback.maxClaimItems),
  };
}

/**
 * Resolve a conservative default, optional wildcard override, then exact source
 * override. A configured-but-invalid policy fails closed instead of silently
 * falling back to a looser pacing rule.
 */
export function resolveInventoryAdapterRatePolicy(
  sourceKey: string,
  rawConfig = resolveInventoryAdapterRuntimeValue("INVENTORY_ADAPTER_RATE_LIMITS_JSON"),
): InventoryAdapterRatePolicy {
  const normalizedSource = sourceKey.trim();
  if (!normalizedSource) throw new Error("ADAPTER_SOURCE_KEY_INVALID");
  if (!rawConfig) return { ...DEFAULT_POLICY };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error("ADAPTER_RATE_LIMIT_CONFIG_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ADAPTER_RATE_LIMIT_CONFIG_INVALID");
  }

  const map = parsed as Record<string, unknown>;
  const wildcard = map["*"] === undefined ? DEFAULT_POLICY : parsePolicy(map["*"], DEFAULT_POLICY);
  return map[normalizedSource] === undefined
    ? { ...wildcard }
    : parsePolicy(map[normalizedSource], wildcard);
}

export class InventoryAdapterRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly kind: "requests" | "claim_units" | "claim_items";

  constructor(kind: "requests" | "claim_units" | "claim_items", retryAfterSeconds: number) {
    super(kind === "claim_items" ? "ADAPTER_CLAIM_LIMIT_EXCEEDED" : "ADAPTER_RATE_LIMITED");
    this.name = "InventoryAdapterRateLimitError";
    this.kind = kind;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function fixedWindow(nowMs: number, windowSeconds: number) {
  if (!Number.isFinite(nowMs)) throw new Error("ADAPTER_RATE_LIMIT_TIME_INVALID");
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((startMs + windowMs - nowMs) / 1000));
  return { windowStart: new Date(startMs), retryAfterSeconds };
}

function rateWindowId(identity: InventoryAdapterIdentity, windowStart: Date) {
  const digest = createHash("sha256")
    .update(`${identity.adapterId}\n${identity.sourceKey}\n${windowStart.toISOString()}`)
    .digest("hex");
  return `adapter_rate_${digest}`;
}

/**
 * Concurrency-safe fixed-window limiter. The unique adapter/source/window key
 * keeps unrelated suppliers isolated. Conditional UPSERT means racing workers
 * cannot collectively exceed the persisted limit.
 */
export async function consumeInventoryAdapterRateLimit(input: {
  identity: InventoryAdapterIdentity;
  requestIncrement?: 0 | 1;
  claimUnits?: number;
  nowMs?: number;
}) {
  const policy = resolveInventoryAdapterRatePolicy(input.identity.sourceKey);
  const requestIncrement = input.requestIncrement ?? 1;
  const claimUnits = input.claimUnits ?? 0;
  if ((requestIncrement !== 0 && requestIncrement !== 1) || !Number.isSafeInteger(claimUnits) || claimUnits < 0) {
    throw new Error("ADAPTER_RATE_LIMIT_INPUT_INVALID");
  }
  if (claimUnits > policy.maxClaimItems) {
    throw new InventoryAdapterRateLimitError("claim_items", 1);
  }

  const nowMs = input.nowMs ?? Date.now();
  const { windowStart, retryAfterSeconds } = fixedWindow(nowMs, policy.windowSeconds);
  const rows = await prisma.$queryRaw<RateWindowRow[]>(Prisma.sql`
    INSERT INTO "InventoryAdapterRateWindow" (
      "id", "adapterId", "sourceKey", "windowStart", "windowSeconds",
      "requestCount", "claimUnits", "createdAt", "updatedAt"
    ) VALUES (
      ${rateWindowId(input.identity, windowStart)}, ${input.identity.adapterId}, ${input.identity.sourceKey},
      ${windowStart}, ${policy.windowSeconds}, ${requestIncrement}, ${claimUnits}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("adapterId", "sourceKey", "windowStart") DO UPDATE SET
      "requestCount" = "InventoryAdapterRateWindow"."requestCount" + ${requestIncrement},
      "claimUnits" = "InventoryAdapterRateWindow"."claimUnits" + ${claimUnits},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE
      "InventoryAdapterRateWindow"."windowSeconds" = ${policy.windowSeconds}
      AND "InventoryAdapterRateWindow"."requestCount" + ${requestIncrement} <= ${policy.maxRequests}
      AND "InventoryAdapterRateWindow"."claimUnits" + ${claimUnits} <= ${policy.maxClaimUnits}
    RETURNING "requestCount", "claimUnits"
  `);

  const row = rows[0];
  if (!row) {
    throw new InventoryAdapterRateLimitError(claimUnits > 0 ? "claim_units" : "requests", retryAfterSeconds);
  }
  return { policy, requestCount: row.requestCount, claimUnits: row.claimUnits, retryAfterSeconds };
}
