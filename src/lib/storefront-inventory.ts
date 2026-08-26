import { prisma } from "./db";
import { readLatestInventoryObservations } from "./inventory-observation-store";
import {
  evaluatePersistedOfferBinding,
  type LivePersistedOffer,
  type PersistedOfferBindingInput,
} from "./persisted-offer-binding";

export type StorefrontInventoryDecision = {
  bindingAllowed: boolean;
  availabilityVerified: boolean;
  availability: "in_stock" | "out_of_stock" | "unknown";
  observedAt: Date | null;
  expiresAt: Date | null;
  reasons: string[];
};

function persistedOfferId(specifications: string) {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const raw = root.supplierOfferV1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const id = (raw as Record<string, unknown>).persistedOfferId;
    if (typeof id !== "string") return null;
    const normalized = id.trim();
    return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
  } catch {
    return null;
  }
}

function normalizedAvailability(value: string | null | undefined): "in_stock" | "out_of_stock" | "unknown" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "in_stock") return "in_stock";
  if (normalized === "out_of_stock") return "out_of_stock";
  return "unknown";
}

const liveOfferSelect = {
  id: true,
  offerKey: true,
  supplierId: true,
  productId: true,
  sourceUrl: true,
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
      name: true,
      active: true,
      sourceClass: true,
      websiteUrl: true,
      resaleAllowed: true,
      sourceVerifiedAt: true,
      verificationSource: true,
      metadata: true,
    },
  },
} as const;

/**
 * Hydrates storefront commerce truth in two bounded reads regardless of the
 * number of products on the page: one persisted-offer query and one latest-
 * observation query. The same binding evaluator used by checkout decides
 * whether a product may be represented as currently buyable from DealForge.
 */
export async function readStorefrontInventoryDecisions(
  products: PersistedOfferBindingInput[],
  nowMs = Date.now(),
): Promise<Map<string, StorefrontInventoryDecision>> {
  const bounded = products.slice(0, 250);
  const idsByProduct = new Map<string, string>();
  for (const product of bounded) {
    const id = persistedOfferId(product.specifications);
    if (id) idsByProduct.set(product.productId, id);
  }

  const offerIds = Array.from(new Set(idsByProduct.values()));
  if (offerIds.length === 0) {
    return new Map(bounded.map((product) => [product.productId, {
      bindingAllowed: false,
      availabilityVerified: false,
      availability: "unknown" as const,
      observedAt: null,
      expiresAt: null,
      reasons: ["persisted_offer_snapshot_missing_or_invalid"],
    }]));
  }

  const [offers, observations] = await Promise.all([
    prisma.supplierOffer.findMany({ where: { id: { in: offerIds } }, select: liveOfferSelect }),
    readLatestInventoryObservations(offerIds),
  ]);
  const offersById = new Map(offers.map((offer) => [offer.id, offer]));

  const decisions = new Map<string, StorefrontInventoryDecision>();
  for (const product of bounded) {
    const offerId = idsByProduct.get(product.productId) ?? null;
    const offer = offerId ? offersById.get(offerId) ?? null : null;
    const observation = offerId ? observations.get(offerId) ?? null : null;
    const liveOffer: LivePersistedOffer | null = offer
      ? { ...offer, latestInventoryObservation: observation }
      : null;
    const binding = evaluatePersistedOfferBinding(product, liveOffer, nowMs);
    const observedAvailability = normalizedAvailability(observation?.availability);

    decisions.set(product.productId, {
      bindingAllowed: binding.allowed,
      availabilityVerified: binding.allowed && observedAvailability === "in_stock",
      availability: observation ? observedAvailability : "unknown",
      observedAt: observation?.observedAt ?? null,
      expiresAt: observation?.expiresAt ?? null,
      reasons: binding.reasons,
    });
  }

  return decisions;
}
