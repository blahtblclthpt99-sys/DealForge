import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listRecoveryCases } from "@/lib/recovery-reconciliation";
import { projectPublicShipment } from "@/lib/shipment-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  const auth = await authorizeAdmin();
  if (auth.response) return noStore(auth.response);

  const intents = await prisma.procurementIntent.findMany({
    where: {
      status: {
        in: [
          "awaiting_review",
          "approved_manual",
          "hold",
          "blocked_source_integrity",
          "supplier_ordered_manual",
          "shipped",
          "delivered",
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      status: true,
      executionMode: true,
      quantity: true,
      expectedUnitCostCents: true,
      expectedTotalCostCents: true,
      currency: true,
      blockedReason: true,
      approvedByUserId: true,
      approvedAt: true,
      supplierOrderReference: true,
      actualTotalCostCents: true,
      executedAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
          orderNumber: true,
          status: true,
          paidAt: true,
          totalCents: true,
          currency: true,
          refunds: {
            select: { idempotencyKey: true, status: true, amountCents: true },
          },
        },
      },
      orderItem: {
        select: {
          title: true,
          productSlug: true,
          quantity: true,
          unitPriceCents: true,
          lineTotalCents: true,
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          eventKey: true,
          type: true,
          actor: true,
          detail: true,
          createdAt: true,
        },
      },
    },
  });

  const reconciled = intents.map((intent) => {
    const expected = intent.expectedTotalCostCents;
    const actual = intent.actualTotalCostCents;
    const revenue = intent.orderItem.lineTotalCents;
    const varianceCents = expected !== null && actual !== null ? actual - expected : null;
    const grossMarginCents = actual !== null ? revenue - actual : null;
    const grossMarginBps =
      grossMarginCents !== null && revenue > 0 ? Math.round((grossMarginCents / revenue) * 10_000) : null;
    const shipmentEvents = intent.events.filter(
      (event) => event.type === "RECORD_SHIPMENT" || event.type === "MARK_DELIVERED",
    );
    const recoveryCases = listRecoveryCases({
      events: intent.events,
      refunds: intent.order.refunds,
      actualTotalCostCents: intent.actualTotalCostCents,
      intentQuantity: intent.quantity,
    });

    return {
      ...intent,
      shipment: projectPublicShipment(shipmentEvents),
      recovery: {
        caseCount: recoveryCases.length,
        openCaseCount: recoveryCases.filter((item) => item.ok && !item.closed).length,
        cases: recoveryCases,
        automaticRecoveryEnabled: false,
      },
      economics: {
        reconciled: actual !== null,
        lineRevenueCents: revenue,
        expectedTotalCostCents: expected,
        actualTotalCostCents: actual,
        varianceCents,
        grossMarginCents,
        grossMarginBps,
      },
    };
  });

  return noStore(
    NextResponse.json({
      automaticSupplierPurchasingEnabled: false,
      automaticRecoveryEnabled: false,
      executionMode: "manual_only",
      intents: reconciled,
    }),
  );
}
