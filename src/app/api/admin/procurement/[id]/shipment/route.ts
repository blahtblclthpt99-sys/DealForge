import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isProcurementStatus,
  procurementEventKey,
  transitionProcurement,
} from "@/lib/procurement-state-machine";
import {
  createShipmentRecord,
  parseShipmentEventDetail,
  TRACKING_CARRIERS,
} from "@/lib/shipment-tracking";
import { readLimitedJson } from "@/lib/request-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isoTimestamp = z.string().trim().min(20).max(40).optional();
const note = z.string().trim().min(1).max(500).optional();
const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_SHIPMENT"),
    expectedState: z.literal("supplier_ordered_manual"),
    carrierCode: z.enum(TRACKING_CARRIERS),
    carrierName: z.string().trim().min(2).max(60).optional(),
    trackingNumber: z.string().trim().min(4).max(100),
    shippedAt: isoTimestamp,
    note,
  }),
  z.object({
    action: z.literal("MARK_DELIVERED"),
    expectedState: z.literal("shipped"),
    deliveredAt: isoTimestamp,
    note,
  }),
]);

async function authorizeAdmin() {
  try {
    return { admin: await requireAdmin(), response: null };
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return {
      admin: null,
      response: NextResponse.json(
        { error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
        { status },
      ),
    };
  }
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function normalizeTimestamp(value: string | undefined) {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + 15 * 60 * 1000) return null;
  return new Date(parsed).toISOString();
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response || !auth.admin) {
    return noStore(auth.response || NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  }

  const read = await readLimitedJson(request, 16 * 1024);
  if (!read.ok) {
    return noStore(
      NextResponse.json(
        { error: read.error === "BODY_TOO_LARGE" ? "SHIPMENT_REQUEST_TOO_LARGE" : "INVALID_SHIPMENT_ACTION" },
        { status: read.error === "BODY_TOO_LARGE" ? 413 : 400 },
      ),
    );
  }
  const parsed = ActionSchema.safeParse(read.value);
  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "INVALID_SHIPMENT_ACTION" }, { status: 400 }));
  }

  const { id } = await context.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.procurementIntent.findUnique({
        where: { id },
        include: {
          order: { select: { status: true, paidAt: true } },
          events: {
            where: { type: { in: ["RECORD_SHIPMENT", "MARK_DELIVERED"] } },
            orderBy: { createdAt: "asc" },
            select: { type: true, detail: true, createdAt: true },
          },
        },
      });
      if (!current) throw new Error("PROCUREMENT_INTENT_NOT_FOUND");
      if (current.executionMode !== "manual_only") throw new Error("PROCUREMENT_EXECUTION_MODE_UNSAFE");
      if (current.blockedReason) throw new Error("PROCUREMENT_SOURCE_INTEGRITY_BLOCKED");
      if (current.order.status !== "paid" || !current.order.paidAt) {
        throw new Error("PROCUREMENT_ORDER_NOT_PAID");
      }
      if (!isProcurementStatus(current.status) || current.status !== parsed.data.expectedState) {
        throw new Error("PROCUREMENT_STATE_CONFLICT");
      }

      const transition = transitionProcurement(current.status, parsed.data.action);
      if (!transition.ok) throw new Error("PROCUREMENT_TRANSITION_INVALID");

      if (parsed.data.action === "RECORD_SHIPMENT") {
        if (
          !current.supplierOrderReference ||
          current.actualTotalCostCents === null ||
          current.actualTotalCostCents <= 0 ||
          !current.executedAt
        ) {
          throw new Error("SHIPMENT_REQUIRES_RECORDED_MANUAL_PURCHASE");
        }
        if (current.events.some((event) => event.type === "RECORD_SHIPMENT")) {
          throw new Error("SHIPMENT_ALREADY_RECORDED");
        }

        const shipment = createShipmentRecord({
          carrierCode: parsed.data.carrierCode,
          carrierName: parsed.data.carrierName,
          trackingNumber: parsed.data.trackingNumber,
          quantity: current.quantity,
          shippedAt: parsed.data.shippedAt,
        });
        if (!shipment) throw new Error("INVALID_SHIPMENT_TRACKING");

        const updated = await tx.procurementIntent.updateMany({
          where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
          data: { status: transition.next },
        });
        if (updated.count !== 1) throw new Error("PROCUREMENT_CONCURRENT_CHANGE");

        await tx.procurementEvent.create({
          data: {
            eventKey: procurementEventKey(current.id, parsed.data.action, randomUUID()),
            procurementIntentId: current.id,
            type: parsed.data.action,
            actor: `admin:${auth.admin.id}`,
            detail: JSON.stringify({
              previousStatus: current.status,
              nextStatus: transition.next,
              shipment,
              note: parsed.data.note || null,
              automaticSupplierPurchasingEnabled: false,
            }),
          },
        });
        return { status: transition.next, shipment };
      }

      const shipmentEvent = current.events.find((event) => event.type === "RECORD_SHIPMENT");
      if (!shipmentEvent) throw new Error("DELIVERY_REQUIRES_SHIPMENT");
      const shipment = parseShipmentEventDetail(shipmentEvent.detail);
      if (!shipment) throw new Error("SHIPMENT_JOURNAL_INVALID");
      if (current.events.some((event) => event.type === "MARK_DELIVERED")) {
        throw new Error("DELIVERY_ALREADY_RECORDED");
      }
      const deliveredAt = normalizeTimestamp(parsed.data.deliveredAt);
      if (!deliveredAt || Date.parse(deliveredAt) < Date.parse(shipment.shippedAt)) {
        throw new Error("INVALID_DELIVERY_TIMESTAMP");
      }

      const updated = await tx.procurementIntent.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data: { status: transition.next },
      });
      if (updated.count !== 1) throw new Error("PROCUREMENT_CONCURRENT_CHANGE");

      const delivery = { version: 1 as const, deliveredAt };
      await tx.procurementEvent.create({
        data: {
          eventKey: procurementEventKey(current.id, parsed.data.action, randomUUID()),
          procurementIntentId: current.id,
          type: parsed.data.action,
          actor: `admin:${auth.admin.id}`,
          detail: JSON.stringify({
            previousStatus: current.status,
            nextStatus: transition.next,
            delivery,
            note: parsed.data.note || null,
            automaticSupplierPurchasingEnabled: false,
          }),
        },
      });
      return { status: transition.next, shipment, delivery };
    });

    return noStore(
      NextResponse.json({
        ok: true,
        procurementIntentId: id,
        automaticSupplierPurchasingEnabled: false,
        ...result,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const notFound = message === "PROCUREMENT_INTENT_NOT_FOUND";
    const invalidInput = ["INVALID_SHIPMENT_TRACKING", "INVALID_DELIVERY_TIMESTAMP"].includes(message);
    if (notFound || invalidInput || message.startsWith("PROCUREMENT_") || message.startsWith("SHIPMENT_") || message.startsWith("DELIVERY_")) {
      return noStore(
        NextResponse.json(
          { error: message },
          { status: notFound ? 404 : invalidInput ? 400 : 409 },
        ),
      );
    }
    console.error("procurement.shipment_action_failed", {
      procurementIntentId: id,
      action: parsed.data.action,
      errorName: error instanceof Error ? error.name : "UNKNOWN",
    });
    return noStore(NextResponse.json({ error: "SHIPMENT_ACTION_FAILED" }, { status: 500 }));
  }
}
