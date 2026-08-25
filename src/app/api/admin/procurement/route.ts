import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
        in: ["awaiting_review", "approved_manual", "hold", "blocked_source_integrity"],
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
        take: 10,
        select: {
          id: true,
          type: true,
          actor: true,
          detail: true,
          createdAt: true,
        },
      },
    },
  });

  return noStore(
    NextResponse.json({
      automaticSupplierPurchasingEnabled: false,
      executionMode: "manual_only",
      intents,
    }),
  );
}
