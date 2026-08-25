import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateInventoryAdapterRequest } from "@/lib/inventory-adapter-auth";
import {
  consumeInventoryAdapterRateLimit,
  InventoryAdapterRateLimitError,
} from "@/lib/inventory-adapter-rate-limit";
import { applyInventoryObservation } from "@/lib/inventory-operations";
import {
  claimDueInventoryRechecks,
  completeInventoryRecheck,
  failInventoryRecheck,
} from "@/lib/inventory-recheck";
import { resolveInventoryRecheckLease } from "@/lib/inventory-recheck-lease";
import { requirePersistedSupplierSourceAuthorization } from "@/lib/supplier-source-authorization";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 24 * 1024;
const MAX_NEXT_RECHECK_MS = 7 * 24 * 60 * 60_000;
const MIN_NEXT_RECHECK_MS = 60_000;

const claimSchema = z.object({
  action: z.literal("claim"),
  workerId: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(25).default(5),
  leaseSeconds: z.number().int().min(30).max(900).default(180),
}).strict();

const observationSchema = z.object({
  availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
  quantity: z.number().int().nonnegative().nullable().optional(),
  inventoryConfidenceBps: z.number().int().min(0).max(10_000),
  observedPriceCents: z.number().int().nonnegative().nullable().optional(),
  observedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  verificationMethod: z.string().trim().min(1).max(80),
  provenance: z.string().trim().min(1).max(2000),
  sourceHealth: z.enum(["healthy", "degraded", "paused", "disabled", "blocked", "degraded_hard"]).nullable().optional(),
  sourceStatusDetail: z.string().trim().max(2000).nullable().optional(),
}).strict();

const observeCompleteSchema = z.object({
  action: z.literal("observe_complete"),
  jobId: z.string().trim().min(1).max(128),
  leaseToken: z.string().trim().min(1).max(400),
  observation: observationSchema,
  nextDueAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const failSchema = z.object({
  action: z.literal("fail"),
  jobId: z.string().trim().min(1).max(128),
  leaseToken: z.string().trim().min(1).max(400),
  error: z.string().trim().min(1).max(1000),
}).strict();

const actionSchema = z.discriminatedUnion("action", [claimSchema, observeCompleteSchema, failSchema]);

async function readRawBody(req: Request) {
  const declared = req.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      throw new Error("ADAPTER_BODY_TOO_LARGE");
    }
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error("ADAPTER_BODY_TOO_LARGE");
  return new TextDecoder().decode(bytes);
}

function validateObservationWindow(observedAt: Date, expiresAt: Date, nowMs: number) {
  if (!Number.isFinite(observedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error("ADAPTER_OBSERVATION_TIME_INVALID");
  }
  if (observedAt.getTime() > nowMs + 5 * 60_000) throw new Error("ADAPTER_OBSERVED_AT_IN_FUTURE");
  if (expiresAt.getTime() <= observedAt.getTime()) throw new Error("ADAPTER_OBSERVATION_WINDOW_INVALID");
}

function validateNextDueAt(value: string | null | undefined, nowMs: number) {
  if (!value) return null;
  const next = new Date(value);
  const delta = next.getTime() - nowMs;
  if (!Number.isFinite(next.getTime()) || delta < MIN_NEXT_RECHECK_MS || delta > MAX_NEXT_RECHECK_MS) {
    throw new Error("ADAPTER_NEXT_DUE_AT_INVALID");
  }
  return next;
}

function errorResponse(error: unknown) {
  if (error instanceof InventoryAdapterRateLimitError) {
    return NextResponse.json(
      { error: error.message, limitKind: error.kind },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(error.retryAfterSeconds),
        },
      },
    );
  }

  const message = error instanceof Error ? error.message : "ADAPTER_REQUEST_FAILED";
  if (message === "ADAPTER_AUTH_NOT_CONFIGURED" || message === "ADAPTER_RATE_LIMIT_CONFIG_INVALID") {
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (
    message === "ADAPTER_SIGNATURE_INVALID" ||
    message === "ADAPTER_TIMESTAMP_INVALID" ||
    message === "ADAPTER_ID_INVALID" ||
    message === "ADAPTER_SOURCE_KEY_INVALID" ||
    message === "ADAPTER_NONCE_INVALID"
  ) {
    return NextResponse.json({ error: "ADAPTER_AUTH_FAILED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_SCOPE_FORBIDDEN" || message === "ADAPTER_SOURCE_NOT_AUTHORIZED") {
    return NextResponse.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_REPLAY_DETECTED" || message === "RECHECK_LEASE_INVALID") {
    return NextResponse.json({ error: message }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (message === "ADAPTER_BODY_TOO_LARGE") {
    return NextResponse.json({ error: message }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  if (message.startsWith("ADAPTER_") || message.startsWith("INVENTORY_") || message.startsWith("RECHECK_")) {
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: "ADAPTER_REQUEST_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  try {
    const rawBody = await readRawBody(req);
    const identity = await authenticateInventoryAdapterRequest({ headers: req.headers, body: rawBody });

    // A valid signature proves adapter identity, not current supplier authority.
    // Re-check live persisted source authorization on every operational request
    // before rate budget consumption, queue access, or inventory mutation.
    await requirePersistedSupplierSourceAuthorization(
      identity.sourceKey,
      "ADAPTER_SOURCE_NOT_AUTHORIZED",
    );

    // Every valid signed and currently authorized machine request consumes the
    // source-scoped request budget before JSON parsing or inventory operation.
    // Replay attempts have already failed during authentication.
    await consumeInventoryAdapterRateLimit({ identity, requestIncrement: 1, claimUnits: 0 });

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "ADAPTER_JSON_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const parsed = actionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "ADAPTER_REQUEST_INVALID", issues: parsed.error.flatten() },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const actor = `adapter:${identity.adapterId}`;
    if (parsed.data.action === "claim") {
      // Claim volume has a second durable budget. This prevents multiple
      // workers sharing one source identity from collectively outrunning the
      // supplier-specific pacing contract even when requests race.
      await consumeInventoryAdapterRateLimit({
        identity,
        requestIncrement: 0,
        claimUnits: parsed.data.limit,
      });
      const result = await claimDueInventoryRechecks({
        sourceKey: identity.sourceKey,
        workerId: `${identity.adapterId}:${parsed.data.workerId}`.slice(0, 160),
        limit: parsed.data.limit,
        leaseSeconds: parsed.data.leaseSeconds,
        actor,
      });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "fail") {
      await resolveInventoryRecheckLease({
        jobId: parsed.data.jobId,
        leaseToken: parsed.data.leaseToken,
        sourceKey: identity.sourceKey,
      });
      const result = await failInventoryRecheck({
        jobId: parsed.data.jobId,
        leaseToken: parsed.data.leaseToken,
        error: parsed.data.error,
        actor,
      });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const lease = await resolveInventoryRecheckLease({
      jobId: parsed.data.jobId,
      leaseToken: parsed.data.leaseToken,
      sourceKey: identity.sourceKey,
    });
    const nowMs = Date.now();
    const observedAt = new Date(parsed.data.observation.observedAt);
    const expiresAt = new Date(parsed.data.observation.expiresAt);
    validateObservationWindow(observedAt, expiresAt, nowMs);
    const nextDueAt = validateNextDueAt(parsed.data.nextDueAt, nowMs);

    const observed = await applyInventoryObservation({
      supplierOfferId: lease.supplierOfferId,
      availability: parsed.data.observation.availability,
      quantity: parsed.data.observation.quantity,
      inventoryConfidenceBps: parsed.data.observation.inventoryConfidenceBps,
      observedPriceCents: parsed.data.observation.observedPriceCents,
      observedAt,
      expiresAt,
      verificationMethod: parsed.data.observation.verificationMethod,
      provenance: parsed.data.observation.provenance,
      sourceHealth: parsed.data.observation.sourceHealth,
      sourceStatusDetail: parsed.data.observation.sourceStatusDetail,
      actor,
    });

    if ("paused" in observed && observed.paused) {
      return NextResponse.json({ error: "ADAPTER_ENGINE_PAUSED" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if ("applied" in observed && observed.applied === false) {
      const failed = await failInventoryRecheck({
        jobId: parsed.data.jobId,
        leaseToken: parsed.data.leaseToken,
        error: "OLDER_THAN_CURRENT_OBSERVATION",
        actor,
      });
      return NextResponse.json(
        { error: "ADAPTER_OBSERVATION_NOT_CURRENT", observed, recheck: failed },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const completed = await completeInventoryRecheck({
      jobId: parsed.data.jobId,
      leaseToken: parsed.data.leaseToken,
      actor,
      nextDueAt,
    });
    return NextResponse.json(
      { ok: true, observed, completed },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
