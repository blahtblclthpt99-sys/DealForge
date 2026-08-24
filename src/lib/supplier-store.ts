import { prisma } from "./db";
import {
  selectBestSupplierOffer,
  type SupplierOfferCandidate,
  type SupplierSelectionPolicy,
} from "./supplier-offers";

export type PersistedSupplierOfferRow = {
  id: string;
  supplierId: string;
  active: boolean;
  availability: string;
  currency: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  priceVerifiedAt: Date | null;
  inventoryConfidenceBps: number;
  priority: number;
  supplier: {
    active: boolean;
    sourceClass: string;
    resaleAllowed: boolean;
    sourceVerifiedAt: Date | null;
  };
};

/**
 * Convert persisted supplier state into the pure fail-closed selector contract.
 * No eligibility is inferred here: missing or weak verification is deliberately
 * passed through so evaluateSupplierOffer() can reject it with an auditable reason.
 */
export function toSupplierOfferCandidate(row: PersistedSupplierOfferRow): SupplierOfferCandidate {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierActive: row.supplier.active,
    offerActive: row.active,
    sourceClass: row.supplier.sourceClass,
    resaleAllowed: row.supplier.resaleAllowed,
    sourceVerifiedAt: row.supplier.sourceVerifiedAt,
    priceVerifiedAt: row.priceVerifiedAt,
    availability: row.availability,
    currency: row.currency,
    itemCostCents: row.itemCostCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    supplierFeeCents: row.supplierFeeCents,
    handlingCents: row.handlingCents,
    inventoryConfidenceBps: row.inventoryConfidenceBps,
    priority: row.priority,
  };
}

const supplierOfferSelect = {
  id: true,
  supplierId: true,
  active: true,
  availability: true,
  currency: true,
  itemCostCents: true,
  shippingCents: true,
  taxCents: true,
  supplierFeeCents: true,
  handlingCents: true,
  priceVerifiedAt: true,
  inventoryConfidenceBps: true,
  priority: true,
  supplier: {
    select: {
      active: true,
      sourceClass: true,
      resaleAllowed: true,
      sourceVerifiedAt: true,
    },
  },
} as const;

/** Read normalized offers for a canonical product. This function never writes. */
export async function loadSupplierOfferCandidates(productId: string) {
  const id = productId.trim();
  if (!id || id.length > 128) return [];

  const rows = await prisma.supplierOffer.findMany({
    where: { productId: id },
    select: supplierOfferSelect,
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 100,
  });
  return rows.map(toSupplierOfferCandidate);
}

/**
 * Evaluate persisted offers using the existing pure selector. Still read-only:
 * selection does not enable commerce, reserve inventory, or purchase anything.
 */
export async function selectPersistedSupplierOffer(
  productId: string,
  policy: SupplierSelectionPolicy,
  nowMs = Date.now(),
) {
  const offers = await loadSupplierOfferCandidates(productId);
  return selectBestSupplierOffer(offers, policy, nowMs);
}
