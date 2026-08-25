import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  applyInventoryObservation,
  sweepInventoryFreshness,
} from "@/lib/inventory-operations";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";

const observationSchema = z.object({
  action: z.literal("observe"),
  supplierOfferId: z.string().trim().min(1).max(128),
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

const sweepSchema = z.object({
  action: z.literal("sweep"),
  limit: z.number().int().min(1).max(250).default(100),
}).strict();

const actionSchema = z.discriminatedUnion("action", [observationSchema, sweepSchema]);

async function requireOwner() {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || user.role !== "admin") throw new Error("FORBIDDEN");
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || user.email.toLowerCase() !== ownerEmail) throw new Error("FORBIDDEN");
  return user;
}

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (!origin) return process.env.NODE_ENV !== "production" && (!site || site === "same-origin" || site === "none");
  try {
    return new URL(origin).origin === new URL(req.url).origin && (!site || site === "same-origin" || site === "none");
  } catch {
    return false;
  }
}

function authError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    if (!sameOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

    const read = await readLimitedJson(req, 24 * 1024);
    if (!read.ok) {
      return NextResponse.json(
        { error: read.error === "BODY_TOO_LARGE" ? "Inventory request too large" : "Invalid JSON" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      );
    }
    const parsed = actionSchema.safeParse(read.value);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.action === "sweep") {
      return NextResponse.json(await sweepInventoryFreshness(owner.email, parsed.data.limit));
    }

    const observedAt = new Date(parsed.data.observedAt);
    const expiresAt = new Date(parsed.data.expiresAt);
    const now = Date.now();
    if (observedAt.getTime() > now + 5 * 60_000) {
      return NextResponse.json({ error: "INVENTORY_OBSERVED_AT_IN_FUTURE" }, { status: 400 });
    }
    if (expiresAt.getTime() <= observedAt.getTime()) {
      return NextResponse.json({ error: "INVENTORY_WINDOW_INVALID" }, { status: 400 });
    }

    const result = await applyInventoryObservation({
      supplierOfferId: parsed.data.supplierOfferId,
      availability: parsed.data.availability,
      quantity: parsed.data.quantity,
      inventoryConfidenceBps: parsed.data.inventoryConfidenceBps,
      observedPriceCents: parsed.data.observedPriceCents,
      observedAt,
      expiresAt,
      verificationMethod: parsed.data.verificationMethod,
      provenance: parsed.data.provenance,
      sourceHealth: parsed.data.sourceHealth,
      sourceStatusDetail: parsed.data.sourceStatusDetail,
      actor: owner.email,
    });
    const olderObservation = "applied" in result && result.applied === false;
    return NextResponse.json(result, { status: olderObservation ? 202 : 201 });
  } catch (error) {
    const auth = authError(error);
    if (auth) return auth;
    const message = error instanceof Error ? error.message : "INVENTORY_OPERATION_FAILED";
    if (message === "SUPPLIER_OFFER_NOT_FOUND") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message === "SUPPLIER_OFFER_NOT_OBSERVABLE") {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const badRequest = message.startsWith("INVENTORY_") && (
      message.endsWith("_INVALID") || message.endsWith("_TOO_LONG")
    );
    return NextResponse.json(
      { error: badRequest ? message : "Inventory operation failed" },
      { status: badRequest ? 400 : 500 },
    );
  }
}
