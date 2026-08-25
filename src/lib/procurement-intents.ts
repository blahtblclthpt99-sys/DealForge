import type { Prisma } from "@prisma/client";
import { ORDER_DESTINATION_SOURCE } from "@/lib/order-destination";

export const PROCUREMENT_EXECUTION_MODE = "manual_only" as const;
export const PROCUREMENT_READY_STATUS = "awaiting_review" as const;
export const PROCUREMENT_BLOCKED_STATUS = "blocked_source_integrity" as const;
export const PROCUREMENT_BLOCKED_REASON = "ORDER_SOURCE_SNAPSHOT_MISSING_OR_INVALID" as const;

type ProcurementOrderItem = {
  id: string;
  orderId: string;
  quantity: number;
  landedCostCents: number | null;
  supplierSnapshot: string;
};

type SnapshotV1 = {
  version: 1;
  persistedSupplierId: string;
  persistedOfferId: string;
  persistedOfferKey: string;
  supplierName: string;
  sourceClass: string;
  sourceUrl: string | null;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  inventoryConfidenceBps: number;
  availability: string;
  currency: string;
  costBreakdown: {
    itemCostCents: number;
    shippingCents: number;
    taxCents: number;
    supplierFeeCents: number;
    handlingCents: number;
    landedCostCents: number;
  };
};

export type ProcurementIntentSeed = {
  status: typeof PROCUREMENT_READY_STATUS | typeof PROCUREMENT_BLOCKED_STATUS;
  executionMode: typeof PROCUREMENT_EXECUTION_MODE;
  supplierSnapshot: string;
  quantity: number;
  expectedUnitCostCents: number | null;
  expectedTotalCostCents: number | null;
  currency: string;
  blockedReason: typeof PROCUREMENT_BLOCKED_REASON | null;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function parseProcurementSupplierSnapshot(raw: string): SnapshotV1 | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) return null;
    const costs = value.costBreakdown;
    if (!costs || typeof costs !== "object" || Array.isArray(costs)) return null;
    const breakdown = costs as Record<string, unknown>;
    const inventoryConfidenceBps = value.inventoryConfidenceBps;

    if (
      !nonEmptyString(value.persistedSupplierId) ||
      !nonEmptyString(value.persistedOfferId) ||
      !nonEmptyString(value.persistedOfferKey) ||
      !nonEmptyString(value.supplierName) ||
      !nonEmptyString(value.sourceClass) ||
      !(value.sourceUrl === null || nonEmptyString(value.sourceUrl)) ||
      !validTimestamp(value.sourceVerifiedAt) ||
      !validTimestamp(value.priceVerifiedAt) ||
      !nonNegativeSafeInteger(inventoryConfidenceBps) ||
      inventoryConfidenceBps > 10_000 ||
      !nonEmptyString(value.availability) ||
      !nonEmptyString(value.currency) ||
      !/^[a-z]{3}$/.test(value.currency.toLowerCase()) ||
      !positiveSafeInteger(breakdown.itemCostCents) ||
      !nonNegativeSafeInteger(breakdown.shippingCents) ||
      !nonNegativeSafeInteger(breakdown.taxCents) ||
      !nonNegativeSafeInteger(breakdown.supplierFeeCents) ||
      !nonNegativeSafeInteger(breakdown.handlingCents) ||
      !positiveSafeInteger(breakdown.landedCostCents)
    ) {
      return null;
    }

    const recomputed =
      breakdown.itemCostCents +
      breakdown.shippingCents +
      breakdown.taxCents +
      breakdown.supplierFeeCents +
      breakdown.handlingCents;
    if (!Number.isSafeInteger(recomputed) || recomputed !== breakdown.landedCostCents) return null;

    return value as unknown as SnapshotV1;
  } catch {
    return null;
  }
}

export function deriveProcurementIntentSeed(
  item: ProcurementOrderItem,
  orderCurrency: string,
): ProcurementIntentSeed {
  const currency = orderCurrency.trim().toLowerCase();
  const snapshot = parseProcurementSupplierSnapshot(item.supplierSnapshot);
  const quantity = positiveSafeInteger(item.quantity) ? item.quantity : null;
  const unitCostCents = positiveSafeInteger(item.landedCostCents) ? item.landedCostCents : null;
  const snapshotMatches =
    snapshot !== null &&
    snapshot.currency.toLowerCase() === currency &&
    unitCostCents !== null &&
    snapshot.costBreakdown.landedCostCents === unitCostCents;
  const expectedTotalCostCents =
    quantity !== null && unitCostCents !== null ? quantity * unitCostCents : null;
  const totalValid =
    expectedTotalCostCents !== null &&
    Number.isSafeInteger(expectedTotalCostCents) &&
    expectedTotalCostCents > 0;

  if (!/^[a-z]{3}$/.test(currency) || quantity === null || !snapshotMatches || !totalValid) {
    return {
      status: PROCUREMENT_BLOCKED_STATUS,
      executionMode: PROCUREMENT_EXECUTION_MODE,
      supplierSnapshot: item.supplierSnapshot,
      quantity: quantity ?? 0,
      expectedUnitCostCents: null,
      expectedTotalCostCents: null,
      currency: /^[a-z]{3}$/.test(currency) ? currency : "usd",
      blockedReason: PROCUREMENT_BLOCKED_REASON,
    };
  }

  return {
    status: PROCUREMENT_READY_STATUS,
    executionMode: PROCUREMENT_EXECUTION_MODE,
    supplierSnapshot: item.supplierSnapshot,
    quantity,
    expectedUnitCostCents: unitCostCents,
    expectedTotalCostCents,
    currency,
    blockedReason: null,
  };
}

export async function ensureProcurementIntentsForPaidOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      paidAt: true,
      currency: true,
      stripeCheckoutSessionId: true,
      destination: {
        select: {
          id: true,
          source: true,
          sourceEventId: true,
          stripeCheckoutSessionId: true,
          name: true,
          line1: true,
          city: true,
          postalCode: true,
          country: true,
          capturedAt: true,
        },
      },
      items: {
        select: {
          id: true,
          orderId: true,
          quantity: true,
          landedCostCents: true,
          supplierSnapshot: true,
        },
      },
    },
  });
  if (!order || order.status !== "paid" || !order.paidAt) {
    throw new Error("PROCUREMENT_REQUIRES_VERIFIED_PAID_ORDER");
  }

  const destination = order.destination;
  if (
    !destination ||
    destination.source !== ORDER_DESTINATION_SOURCE ||
    !/^evt_[A-Za-z0-9_]+$/.test(destination.sourceEventId) ||
    !order.stripeCheckoutSessionId ||
    destination.stripeCheckoutSessionId !== order.stripeCheckoutSessionId ||
    !nonEmptyString(destination.name) ||
    !nonEmptyString(destination.line1) ||
    !nonEmptyString(destination.city) ||
    !nonEmptyString(destination.postalCode) ||
    !/^[A-Z]{2}$/.test(destination.country) ||
    !(destination.capturedAt instanceof Date) ||
    !Number.isFinite(destination.capturedAt.getTime())
  ) {
    throw new Error("PROCUREMENT_REQUIRES_VERIFIED_ORDER_DESTINATION");
  }

  let readyCount = 0;
  let blockedCount = 0;

  for (const item of order.items) {
    const seed = deriveProcurementIntentSeed(item, order.currency);
    const idempotencyKey = `procurement:order-item:${item.id}`;
    const intent = await tx.procurementIntent.upsert({
      where: { orderItemId: item.id },
      create: {
        idempotencyKey,
        orderId: order.id,
        orderItemId: item.id,
        ...seed,
      },
      update: {},
    });

    if (
      intent.orderId !== order.id ||
      intent.orderItemId !== item.id ||
      intent.idempotencyKey !== idempotencyKey ||
      intent.executionMode !== PROCUREMENT_EXECUTION_MODE ||
      intent.supplierSnapshot !== seed.supplierSnapshot ||
      intent.quantity !== seed.quantity ||
      intent.expectedUnitCostCents !== seed.expectedUnitCostCents ||
      intent.expectedTotalCostCents !== seed.expectedTotalCostCents ||
      intent.currency !== seed.currency ||
      intent.status !== seed.status ||
      intent.blockedReason !== seed.blockedReason
    ) {
      throw new Error("PROCUREMENT_INTENT_IMMUTABLE_MISMATCH");
    }

    const eventType =
      seed.status === PROCUREMENT_READY_STATUS
        ? "PAYMENT_AND_DESTINATION_VERIFIED_PROCUREMENT_INTENT_CREATED"
        : "PAYMENT_AND_DESTINATION_VERIFIED_PROCUREMENT_INTENT_BLOCKED";
    await tx.procurementEvent.upsert({
      where: { eventKey: `procurement-created:${item.id}` },
      create: {
        eventKey: `procurement-created:${item.id}`,
        procurementIntentId: intent.id,
        type: eventType,
        actor: "stripe_webhook",
        detail: JSON.stringify({
          orderId: order.id,
          orderItemId: item.id,
          destinationId: destination.id,
          destinationCountry: destination.country,
          status: seed.status,
          blockedReason: seed.blockedReason,
          executionMode: seed.executionMode,
        }),
      },
      update: {},
    });

    if (seed.status === PROCUREMENT_READY_STATUS) readyCount += 1;
    else blockedCount += 1;
  }

  return { readyCount, blockedCount, totalCount: order.items.length };
}
