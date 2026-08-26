import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isProcurementStatus,
  procurementEventKey,
  transitionProcurement,
} from "@/lib/procurement-state-machine";
import {
  createDeliveryRecord,
  createShipmentRecord,
  summarizeShipmentJournal,
  TRACKING_CARRIERS,
} from "@/lib/shipment-tracking";
import { readLimitedJson } from "@/lib/request-json";
import {
  isSameOriginProcurementMutation,
  requireProcurementOwner,
} from "@/lib/procurement-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isoTimestamp = z.string().trim().min(20).max(40).optional();
const note = z.string().trim().min(1).max(500).optional();
const packageId = z.string().trim().regex(/^pkg_[a-f0-9]{24}$/).optional();
const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_SHIPMENT"),
    expectedState: z.enum(["supplier_ordered_manual", "shipped"]),
    carrierCode: z.enum(TRACKING_CARRIERS),
    carrierName: z.string().trim().min(2).max(60).optional(),
    trackingNumber: z.string().trim().min(4).max(100),
    quantity: z.number().int().positive().max(100000).optional(),
    shippedAt: isoTimestamp,
    note,
  }),
  z.object({
    action: z.literal("MARK_DELIVERED"),
    expectedState: z.literal("shipped"),
    packageId,
    deliveredAt: isoTimestamp,
    note,
  }),
]);

async function authorizeAdmin() {
  try {
    return { admin: await requireProcurementOwner(), response: null };
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdmin();
  if (auth.response || !auth.admin) {
    return noStore(auth.response || NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  }
  if (!isSameOriginProcurementMutation(request)) {
    return noStore(NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 }));
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

      const journal = summarizeShipmentJournal(current.events);
      if (!journal.ok) throw new Error(journal.reason);

      if (parsed.data.action === "RECORD_SHIPMENT") {
        if (
          !current.supplierOrderReference ||
          current.actualTotalCostCents === null ||
          current.actualTotalCostCents <= 0 ||
          !current.executedAt
        ) {
          throw new Error("SHIPMENT_REQUIRES_RECORDED_MANUAL_PURCHASE");
        }

        const remainingQuantity = current.quantity - journal.shippedQuantity;
        if (remainingQuantity <= 0) throw new Error("SHIPMENT_FULL_QUANTITY_ALREADY_RECORDED");
        const shipmentQuantity = parsed.data.quantity ?? remainingQuantity;
        if (shipmentQuantity > remainingQuantity) throw new Error("SHIPMENT_QUANTITY_EXCEEDS_REMAINING");

        const shipment = createShipmentRecord({
          carrierCode: parsed.data.carrierCode,
          carrierName: parsed.data.carrierName,
          trackingNumber: parsed.data.trackingNumber,
          quantity: shipmentQuantity,
          shippedAt: parsed.data.shippedAt,
        });
        if (!shipment) throw new Error("INVALID_SHIPMENT_TRACKING");
        if (journal.packages.some((entry) => entry.packageId === shipment.packageId)) {
          throw new Error("SHIPMENT_PACKAGE_ALREADY_RECORDED");
        }

        const nextStatus = transition.next;
        const updated = await tx.procurementIntent.updateMany({
          where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
          data: { status: nextStatus },
        });
        if (updated.count !== 1) throw new Error("PROCUREMENT_CONCURRENT_CHANGE");

        await tx.procurementEvent.create({
          data: {
            eventKey: procurementEventKey(current.id, parsed.data.action, shipment.packageId),
            procurementIntentId: current.id,
            type: parsed.data.action,
            actor: `owner:${auth.admin.id}`,
            detail: JSON.stringify({
              previousStatus: current.status,
              nextStatus,
              shipment,
              orderedQuantity: current.quantity,
              shippedQuantityBefore: journal.shippedQuantity,
              shippedQuantityAfter: journal.shippedQuantity + shipment.quantity,
              note: parsed.data.note || null,
              automaticSupplierPurchasingEnabled: false,
            }),
          },
        });
        return {
          status: nextStatus,
          shipment,
          fulfillment: {
            orderedQuantity: current.quantity,
            shippedQuantity: journal.shippedQuantity + shipment.quantity,
            deliveredQuantity: journal.deliveredQuantity,
          },
        };
      }

      if (journal.packages.length === 0) throw new Error("DELIVERY_REQUIRES_SHIPMENT");
      const undelivered = journal.packages.filter((entry) => !entry.deliveredAt);
      const targetPackage = parsed.data.packageId
        ? journal.packages.find((entry) => entry.packageId === parsed.data.packageId)
        : undelivered.length === 1
          ? undelivered[0]
          : null;
      if (!targetPackage) {
        throw new Error(parsed.data.packageId ? "DELIVERY_PACKAGE_NOT_FOUND" : "DELIVERY_PACKAGE_ID_REQUIRED");
      }
      if (targetPackage.deliveredAt) throw new Error("DELIVERY_PACKAGE_ALREADY_RECORDED");

      const delivery = createDeliveryRecord({
        packageId: targetPackage.packageId,
        deliveredAt: parsed.data.deliveredAt,
      });
      if (!delivery || Date.parse(delivery.deliveredAt) < Date.parse(targetPackage.shippedAt)) {
        throw new Error("INVALID_DELIVERY_TIMESTAMP");
      }

      const deliveredQuantityAfter = journal.deliveredQuantity + targetPackage.quantity;
      const fullyShipped = journal.shippedQuantity === current.quantity;
      const everyRecordedPackageDelivered = journal.packages.every(
        (entry) => Boolean(entry.deliveredAt) || entry.packageId === targetPackage.packageId,
      );
      const nextStatus = fullyShipped && everyRecordedPackageDelivered ? transition.next : "shipped";

      const updated = await tx.procurementIntent.updateMany({
        where: { id: current.id, status: current.status, updatedAt: current.updatedAt },
        data: { status: nextStatus },
      });
      if (updated.count !== 1) throw new Error("PROCUREMENT_CONCURRENT_CHANGE");

      await tx.procurementEvent.create({
        data: {
          eventKey: procurementEventKey(current.id, parsed.data.action, targetPackage.packageId),
          procurementIntentId: current.id,
          type: parsed.data.action,
          actor: `owner:${auth.admin.id}`,
          detail: JSON.stringify({
            previousStatus: current.status,
            nextStatus,
            delivery,
            orderedQuantity: current.quantity,
            shippedQuantity: journal.shippedQuantity,
            deliveredQuantityBefore: journal.deliveredQuantity,
            deliveredQuantityAfter,
            note: parsed.data.note || null,
            automaticSupplierPurchasingEnabled: false,
          }),
        },
      });
      return {
        status: nextStatus,
        package: targetPackage,
        delivery,
        fulfillment: {
          orderedQuantity: current.quantity,
          shippedQuantity: journal.shippedQuantity,
          deliveredQuantity: deliveredQuantityAfter,
        },
      };
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
    if (
      notFound ||
      invalidInput ||
      message.startsWith("PROCUREMENT_") ||
      message.startsWith("SHIPMENT_") ||
      message.startsWith("DELIVERY_")
    ) {
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
