export const fulfillmentStates = [
  "awaiting_sourcing",
  "sourcing",
  "supplier_ordered",
  "shipped",
  "delivered",
  "hold",
] as const;

export type FulfillmentState = (typeof fulfillmentStates)[number];

export const fulfillmentActions = [
  "START_SOURCING",
  "MARK_SUPPLIER_ORDERED",
  "MARK_SHIPPED",
  "MARK_DELIVERED",
  "PLACE_HOLD",
  "RESUME_SOURCING",
] as const;

export type FulfillmentAction = (typeof fulfillmentActions)[number];

const transitions: Record<FulfillmentAction, readonly FulfillmentState[]> = {
  START_SOURCING: ["awaiting_sourcing"],
  MARK_SUPPLIER_ORDERED: ["sourcing"],
  MARK_SHIPPED: ["supplier_ordered"],
  MARK_DELIVERED: ["shipped"],
  PLACE_HOLD: ["awaiting_sourcing", "sourcing", "supplier_ordered"],
  RESUME_SOURCING: ["hold"],
};

const nextStates: Record<FulfillmentAction, FulfillmentState> = {
  START_SOURCING: "sourcing",
  MARK_SUPPLIER_ORDERED: "supplier_ordered",
  MARK_SHIPPED: "shipped",
  MARK_DELIVERED: "delivered",
  PLACE_HOLD: "hold",
  RESUME_SOURCING: "sourcing",
};

export function fulfillmentLogSource(orderId: string) {
  return `order-fulfillment:${orderId}`;
}

export function isFulfillmentState(value: unknown): value is FulfillmentState {
  return typeof value === "string" && (fulfillmentStates as readonly string[]).includes(value);
}

export function stateFromFulfillmentMeta(meta: unknown): FulfillmentState | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const state = (meta as Record<string, unknown>).nextState;
  return isFulfillmentState(state) ? state : null;
}

export function transitionFulfillment(
  current: FulfillmentState,
  action: FulfillmentAction,
): { ok: true; next: FulfillmentState } | { ok: false; reason: "INVALID_TRANSITION" } {
  if (!transitions[action].includes(current)) {
    return { ok: false, reason: "INVALID_TRANSITION" };
  }
  return { ok: true, next: nextStates[action] };
}

export function estimatedOrderLandedCostCents(
  items: Array<{ quantity: number; landedCostCents: number | null }>,
) {
  let total = 0;
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isSafeInteger(item.landedCostCents) ||
      (item.landedCostCents ?? 0) <= 0
    ) return null;
    const line = item.quantity * (item.landedCostCents as number);
    if (!Number.isSafeInteger(line) || line <= 0) return null;
    total += line;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total > 0 ? total : null;
}

export function validateSupplierLineCoverage(
  orderItems: Array<{ id: string }>,
  supplierOrders: Array<{ orderItemId: string; actualCostCents: number }>,
) {
  if (orderItems.length !== supplierOrders.length) return false;
  const expected = new Set(orderItems.map((item) => item.id));
  const seen = new Set<string>();
  for (const supplierOrder of supplierOrders) {
    if (
      !expected.has(supplierOrder.orderItemId) ||
      seen.has(supplierOrder.orderItemId) ||
      !Number.isSafeInteger(supplierOrder.actualCostCents) ||
      supplierOrder.actualCostCents <= 0
    ) return false;
    seen.add(supplierOrder.orderItemId);
  }
  return seen.size === expected.size;
}
