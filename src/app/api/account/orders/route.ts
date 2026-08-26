import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  projectPublicShipment,
  projectPublicShipments,
  publicFulfillmentStatus,
} from "@/lib/shipment-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET() {
  let session;
  try {
    session = await requireUser();
  } catch {
    return noStore(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }));
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true },
  });
  if (!currentUser || currentUser.email.toLowerCase() !== session.email.toLowerCase()) {
    return noStore(NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }));
  }

  const orders = await prisma.order.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      orderNumber: true,
      status: true,
      currency: true,
      subtotalCents: true,
      shippingCents: true,
      taxCents: true,
      totalCents: true,
      paidAt: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          productSlug: true,
          title: true,
          quantity: true,
          unitPriceCents: true,
          lineTotalCents: true,
          procurementIntent: {
            select: {
              status: true,
              events: {
                where: { type: { in: ["RECORD_SHIPMENT", "MARK_DELIVERED"] } },
                orderBy: { createdAt: "asc" },
                select: { type: true, detail: true, createdAt: true },
              },
            },
          },
        },
      },
    },
  });

  const customerOrders = orders.map((order) => ({
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    items: order.items.map((item) => {
      const events = item.procurementIntent?.events || [];
      const internalFulfillmentStatus = publicFulfillmentStatus(
        item.procurementIntent?.status || "processing",
      );
      const projectedShipment = projectPublicShipment(events, item.quantity);
      const projectedShipments = projectPublicShipments(events, item.quantity);
      const shippedQuantity = projectedShipments.reduce((total, shipment) => total + shipment.quantity, 0);
      const deliveredQuantity = projectedShipments
        .filter((shipment) => shipment.status === "delivered")
        .reduce((total, shipment) => total + shipment.quantity, 0);
      const packageProjectionConsistent =
        projectedShipments.length > 0 &&
        shippedQuantity <= item.quantity &&
        (internalFulfillmentStatus === "shipped"
          ? shippedQuantity < item.quantity || deliveredQuantity < item.quantity
          : internalFulfillmentStatus === "delivered"
            ? shippedQuantity === item.quantity && deliveredQuantity === item.quantity
            : false);
      const fulfillmentConsistent =
        internalFulfillmentStatus !== "processing" && packageProjectionConsistent;

      return {
        id: item.id,
        productSlug: item.productSlug,
        title: item.title,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
        fulfillmentStatus: fulfillmentConsistent ? internalFulfillmentStatus : "processing",
        shipment: fulfillmentConsistent ? projectedShipment : null,
        shipments: fulfillmentConsistent ? projectedShipments : [],
      };
    }),
  }));

  return noStore(NextResponse.json({ orders: customerOrders }));
}
