import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  estimatedOrderLandedCostCents,
  fulfillmentLogSource,
  fulfillmentStates,
  stateFromFulfillmentMeta,
  transitionFulfillment,
  validateSupplierLineCoverage,
} from "@/lib/order-fulfillment";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const expectedState = z.enum(fulfillmentStates);
const shortNote = z.string().trim().min(1).max(500).optional();
const safeReference = z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9 ._#:\/-]+$/);

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("START_SOURCING"),
    expectedState,
    note: shortNote,
  }),
  z.object({
    action: z.literal("MARK_SUPPLIER_ORDERED"),
    expectedState,
    manualPurchaseConfirmed: z.literal(true),
    supplierOrders: z.array(z.object({
      orderItemId: z.string().trim().min(1).max(128),
      supplierOrderReference: safeReference,
      actualCostCents: z.number().int().positive().max(100_000_000),
    })).min(1).max(20),
    acceptCostVariance: z.boolean().optional(),
    acceptLossRisk: z.boolean().optional(),
    note: shortNote,
  }),
  z.object({
    action: z.literal("MARK_SHIPPED"),
    expectedState,
    carrier: z.string().trim().min(2).max(80),
    trackingNumber: safeReference,
    note: shortNote,
  }),
  z.object({
    action: z.literal("MARK_DELIVERED"),
    expectedState,
    note: shortNote,
  }),
  z.object({
    action: z.literal("PLACE_HOLD"),
    expectedState,
    reason: z.string().trim().min(3).max(240),
    note: shortNote,
  }),
  z.object({
    action: z.literal("RESUME_SOURCING"),
    expectedState,
    note: shortNote,
  }),
]);

async function currentOwner() {
  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || !(await isProductOwner(user))) return null;
  return user;
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function addSafeCents(values: number[]) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total > 0 ? total : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await currentOwner();
  if (!owner) return noStore(NextResponse.json({ error: "Forbidden" }, { status: 403 }));

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return noStore(NextResponse.json({ error: "INVALID_FULFILLMENT_REQUEST" }, { status: 400 }));
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "INVALID_FULFILLMENT_REQUEST" }, { status: 400 }));
  }

  const { id } = await context.params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, payments: true },
  });
  if (!order) return noStore(NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 }));

  if (order.status !== "paid" || !order.paidAt || !order.stripePaymentIntentId) {
    return noStore(NextResponse.json({ error: "ORDER_NOT_SOURCEABLE_FINANCIAL_STATE" }, { status: 409 }));
  }
  const certifiedPayment = order.payments.find(
    (payment) =>
      payment.status === "succeeded" &&
      payment.providerPaymentId === order.stripePaymentIntentId &&
      payment.amountCents === order.totalCents &&
      payment.currency.toLowerCase() === order.currency.toLowerCase(),
  );
  if (!certifiedPayment) {
    return noStore(NextResponse.json({ error: "ORDER_PAYMENT_LEDGER_NOT_CERTIFIED" }, { status: 409 }));
  }

  const source = fulfillmentLogSource(order.id);
  const lastLog = await prisma.systemLog.findFirst({ where: { source }, orderBy: { createdAt: "desc" } });
  const lastMeta = lastLog ? parseJson<Record<string, unknown>>(lastLog.meta, {}) : {};
  const currentState = stateFromFulfillmentMeta(lastMeta) || "awaiting_sourcing";
  if (parsed.data.expectedState !== currentState) {
    return noStore(NextResponse.json({ error: "FULFILLMENT_STATE_CONFLICT", currentState }, { status: 409 }));
  }

  const transition = transitionFulfillment(currentState, parsed.data.action);
  if (!transition.ok) {
    return noStore(NextResponse.json({ error: transition.reason, currentState }, { status: 409 }));
  }

  const details: Record<string, unknown> = {
    note: parsed.data.note || null,
    automaticSupplierPurchasingEnabled: false,
  };

  if (parsed.data.action === "MARK_SUPPLIER_ORDERED") {
    if (!validateSupplierLineCoverage(order.items, parsed.data.supplierOrders)) {
      return noStore(NextResponse.json({ error: "SUPPLIER_LINE_COVERAGE_INVALID" }, { status: 400 }));
    }
    const estimatedCostCents = estimatedOrderLandedCostCents(order.items);
    const actualCostCents = addSafeCents(parsed.data.supplierOrders.map((item) => item.actualCostCents));
    if (estimatedCostCents === null || actualCostCents === null) {
      return noStore(NextResponse.json({ error: "SUPPLIER_COST_INVALID" }, { status: 409 }));
    }
    const costVarianceCents = actualCostCents - estimatedCostCents;
    if (costVarianceCents > 0 && parsed.data.acceptCostVariance !== true) {
      return noStore(NextResponse.json({
        error: "SUPPLIER_COST_VARIANCE_REQUIRES_ACKNOWLEDGEMENT",
        estimatedCostCents,
        actualCostCents,
        costVarianceCents,
      }, { status: 422 }));
    }
    if (actualCostCents >= order.totalCents && parsed.data.acceptLossRisk !== true) {
      return noStore(NextResponse.json({
        error: "SUPPLIER_COST_LOSS_RISK_REQUIRES_ACKNOWLEDGEMENT",
        orderTotalCents: order.totalCents,
        actualCostCents,
      }, { status: 422 }));
    }
    details.manualPurchaseConfirmed = true;
    details.supplierOrders = parsed.data.supplierOrders;
    details.estimatedCostCents = estimatedCostCents;
    details.actualCostCents = actualCostCents;
    details.costVarianceCents = costVarianceCents;
    details.acceptCostVariance = parsed.data.acceptCostVariance === true;
    details.acceptLossRisk = parsed.data.acceptLossRisk === true;
  } else if (parsed.data.action === "MARK_SHIPPED") {
    details.carrier = parsed.data.carrier;
    details.trackingNumber = parsed.data.trackingNumber;
  } else if (parsed.data.action === "PLACE_HOLD") {
    details.reason = parsed.data.reason;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: order.id },
        select: { id: true, orderNumber: true, status: true, updatedAt: true },
      });
      if (!current || current.status !== "paid") throw new Error("FULFILLMENT_FINANCIAL_STATE_CHANGED");

      const latest = await tx.systemLog.findFirst({ where: { source }, orderBy: { createdAt: "desc" } });
      const latestMeta = latest ? parseJson<Record<string, unknown>>(latest.meta, {}) : {};
      const transactionState = stateFromFulfillmentMeta(latestMeta) || "awaiting_sourcing";
      if (transactionState !== parsed.data.expectedState) throw new Error("FULFILLMENT_STATE_CHANGED");
      const transactionTransition = transitionFulfillment(transactionState, parsed.data.action);
      if (!transactionTransition.ok) throw new Error("FULFILLMENT_TRANSITION_CHANGED");

      const now = new Date();
      const lock = await tx.order.updateMany({
        where: { id: current.id, status: "paid", updatedAt: current.updatedAt },
        data: { updatedAt: now },
      });
      if (lock.count !== 1) throw new Error("FULFILLMENT_ORDER_CONCURRENT_CHANGE");

      await tx.systemLog.create({
        data: {
          level: parsed.data.action === "PLACE_HOLD" ? "warn" : "info",
          source,
          message: parsed.data.action,
          meta: JSON.stringify({
            orderId: current.id,
            orderNumber: current.orderNumber,
            previousState: transactionState,
            nextState: transactionTransition.next,
            action: parsed.data.action,
            performedByUserId: owner.id,
            performedAt: now.toISOString(),
            financialStatus: current.status,
            ...details,
          }),
        },
      });

      return { previousState: transactionState, nextState: transactionTransition.next, performedAt: now.toISOString() };
    });

    return noStore(NextResponse.json({ ok: true, orderId: order.id, orderNumber: order.orderNumber, ...result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message.startsWith("FULFILLMENT_")) {
      return noStore(NextResponse.json({ error: "FULFILLMENT_STATE_CONFLICT" }, { status: 409 }));
    }
    console.error("commerce.fulfillment.transition_failed", { orderId: order.id, errorName: error instanceof Error ? error.name : "UNKNOWN" });
    return noStore(NextResponse.json({ error: "FULFILLMENT_UPDATE_FAILED" }, { status: 500 }));
  }
}
