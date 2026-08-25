import { createHash } from "node:crypto";
import {
  MAX_PRICE_AGE_MINUTES,
  MAX_SOURCE_AGE_DAYS,
  MIN_INVENTORY_CONFIDENCE_BPS,
  prepareCommercialization,
  type DirectResaleSourceClass,
  type PreparedCommercialization,
} from "./commercialization";
import { prisma } from "./db";
import { isDirectResaleSourceClass } from "./source-policy";
import { selectPersistedSupplierOffer } from "./supplier-store";
import type { SupplierSelectionResult } from "./supplier-offers";

export type PersistedCommercializationInput = {
  productId: string;
  productCurrency: string;
  existingSpecifications: string;
  supplierName: string;
  sourceClass: DirectResaleSourceClass;
  sourceUrl?: string | null;
  resaleAllowed: true;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  sellingPriceCents: number;
  inventoryConfidenceBps: number;
  acquisitionReserveCents: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
};

export type PersistedCommercializationResult = {
  submittedSupplierId: string;
  submittedOfferId: string;
  submittedOfferKey: string;
  selection: SupplierSelectionResult;
  prepared: PreparedCommercialization | null;
};

type CommercializationSnapshot = {
  sourceUrl: string | null;
  sourceVerifiedAt: string;
  priceVerifiedAt: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedSupplierName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function supplierPersistenceKey(name: string, sourceClass: string) {
  return `supplier_v1_${sha256(`${sourceClass.trim().toLowerCase()}:${normalizedSupplierName(name)}`)}`;
}

export function supplierOfferPersistenceKey(productId: string, supplierKey: string, sourceUrl: string | null) {
  return `offer_v1_${sha256(`${productId.trim()}:${supplierKey}:${sourceUrl ?? "manual"}`)}`;
}

function canonicalSnapshot(specifications: string): CommercializationSnapshot {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const raw = root.supplierOfferV1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    const offer = raw as Record<string, unknown>;
    const sourceVerifiedAt = typeof offer.sourceVerifiedAt === "string" ? offer.sourceVerifiedAt : "";
    const priceVerifiedAt = typeof offer.priceVerifiedAt === "string" ? offer.priceVerifiedAt : "";
    const sourceUrl = typeof offer.sourceUrl === "string" ? offer.sourceUrl : null;
    if (!sourceVerifiedAt || !priceVerifiedAt) throw new Error();
    return { sourceUrl, sourceVerifiedAt, priceVerifiedAt };
  } catch {
    throw new Error("COMMERCIALIZATION_SNAPSHOT_INVALID");
  }
}

function sameOfferObservation(
  current: {
    sourceUrl: string | null;
    availability: string;
    currency: string;
    itemCostCents: number;
    shippingCents: number;
    taxCents: number;
    supplierFeeCents: number;
    handlingCents: number;
    inventoryConfidenceBps: number;
  },
  next: PersistedCommercializationInput,
  sourceUrl: string | null,
  currency: string,
) {
  return (
    current.sourceUrl === sourceUrl &&
    current.availability === next.availability &&
    current.currency.toLowerCase() === currency &&
    current.itemCostCents === next.itemCostCents &&
    current.shippingCents === next.shippingCents &&
    current.taxCents === next.taxCents &&
    current.supplierFeeCents === next.supplierFeeCents &&
    current.handlingCents === next.handlingCents &&
    current.inventoryConfidenceBps === next.inventoryConfidenceBps
  );
}

function annotatePersistedSelection(
  specifications: string,
  selected: { supplierId: string; id: string; offerKey?: string },
) {
  const root = JSON.parse(specifications) as Record<string, unknown>;
  const raw = root.supplierOfferV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("COMMERCIALIZATION_SNAPSHOT_INVALID");
  }
  root.supplierOfferV1 = {
    ...(raw as Record<string, unknown>),
    persistedSupplierId: selected.supplierId,
    persistedOfferId: selected.id,
    persistedOfferKey: selected.offerKey ?? null,
  };
  return JSON.stringify(root);
}

/**
 * Persist one owner-verified supplier observation, then select only from the
 * normalized persisted offer set. Older price/source observations never roll
 * newer verification state backward. This function never purchases, reserves
 * inventory, or changes the global commerce switch.
 */
export async function persistSelectAndPrepareCommercialization(
  input: PersistedCommercializationInput,
  nowMs = Date.now(),
): Promise<PersistedCommercializationResult> {
  const productId = input.productId.trim();
  if (!productId || productId.length > 128) throw new Error("PRODUCT_ID_INVALID");

  const currency = input.productCurrency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("PRODUCT_CURRENCY_INVALID");

  // Reuse the existing commercial gate parser as the validation boundary before
  // any supplier persistence occurs. Its output also gives us the canonical URL
  // and normalized timestamps used for stable persistence keys.
  const submittedPreflight = prepareCommercialization(
    input.existingSpecifications,
    {
      supplierName: input.supplierName,
      sourceClass: input.sourceClass,
      sourceUrl: input.sourceUrl,
      resaleAllowed: input.resaleAllowed,
      sourceVerifiedAt: input.sourceVerifiedAt,
      priceVerifiedAt: input.priceVerifiedAt,
      itemCostCents: input.itemCostCents,
      shippingCents: input.shippingCents,
      taxCents: input.taxCents,
      supplierFeeCents: input.supplierFeeCents,
      handlingCents: input.handlingCents,
      sellingPriceCents: input.sellingPriceCents,
      inventoryConfidenceBps: input.inventoryConfidenceBps,
      acquisitionReserveCents: input.acquisitionReserveCents,
      availability: input.availability,
    },
    nowMs,
  );
  const snapshot = canonicalSnapshot(submittedPreflight.specifications);
  const sourceVerifiedAt = new Date(snapshot.sourceVerifiedAt);
  const priceVerifiedAt = new Date(snapshot.priceVerifiedAt);
  const supplierName = input.supplierName.trim().replace(/\s+/g, " ");
  const supplierKey = supplierPersistenceKey(supplierName, input.sourceClass);
  const offerKey = supplierOfferPersistenceKey(productId, supplierKey, snapshot.sourceUrl);
  const websiteUrl = snapshot.sourceUrl ? new URL(snapshot.sourceUrl).origin : null;

  const supplier = await prisma.supplier.upsert({
    where: { key: supplierKey },
    create: {
      key: supplierKey,
      name: supplierName,
      sourceClass: input.sourceClass,
      websiteUrl,
      active: true,
      resaleAllowed: true,
      sourceVerifiedAt,
      verificationSource: "owner_manual",
    },
    update: {
      name: supplierName,
      websiteUrl: websiteUrl ?? undefined,
      active: true,
      resaleAllowed: true,
    },
  });
  if (supplier.sourceClass !== input.sourceClass) throw new Error("SUPPLIER_KEY_CONFLICT");

  await prisma.supplier.updateMany({
    where: {
      id: supplier.id,
      OR: [{ sourceVerifiedAt: null }, { sourceVerifiedAt: { lt: sourceVerifiedAt } }],
    },
    data: { sourceVerifiedAt, verificationSource: "owner_manual" },
  });

  const initialOffer = await prisma.supplierOffer.upsert({
    where: { offerKey },
    create: {
      offerKey,
      supplierId: supplier.id,
      productId,
      sourceUrl: snapshot.sourceUrl,
      active: true,
      availability: input.availability,
      currency,
      itemCostCents: input.itemCostCents,
      shippingCents: input.shippingCents,
      taxCents: input.taxCents,
      supplierFeeCents: input.supplierFeeCents,
      handlingCents: input.handlingCents,
      priceVerifiedAt,
      inventoryConfidenceBps: input.inventoryConfidenceBps,
    },
    update: { active: true },
  });
  if (initialOffer.supplierId !== supplier.id || initialOffer.productId !== productId) {
    throw new Error("SUPPLIER_OFFER_KEY_CONFLICT");
  }

  const currentPriceVerifiedAt = initialOffer.priceVerifiedAt?.getTime() ?? null;
  if (
    currentPriceVerifiedAt === priceVerifiedAt.getTime() &&
    !sameOfferObservation(initialOffer, input, snapshot.sourceUrl, currency)
  ) {
    throw new Error("SUPPLIER_OFFER_VERIFICATION_CONFLICT");
  }

  if (currentPriceVerifiedAt === null || currentPriceVerifiedAt < priceVerifiedAt.getTime()) {
    await prisma.supplierOffer.update({
      where: { id: initialOffer.id },
      data: {
        sourceUrl: snapshot.sourceUrl,
        active: true,
        availability: input.availability,
        currency,
        itemCostCents: input.itemCostCents,
        shippingCents: input.shippingCents,
        taxCents: input.taxCents,
        supplierFeeCents: input.supplierFeeCents,
        handlingCents: input.handlingCents,
        priceVerifiedAt,
        inventoryConfidenceBps: input.inventoryConfidenceBps,
      },
    });
  }

  const selection = await selectPersistedSupplierOffer(
    productId,
    {
      currency,
      maxSourceAgeDays: MAX_SOURCE_AGE_DAYS,
      maxPriceAgeMinutes: MAX_PRICE_AGE_MINUTES,
      minInventoryConfidenceBps: MIN_INVENTORY_CONFIDENCE_BPS,
    },
    nowMs,
  );

  if (!selection.selected) {
    return {
      submittedSupplierId: supplier.id,
      submittedOfferId: initialOffer.id,
      submittedOfferKey: offerKey,
      selection,
      prepared: null,
    };
  }

  const selected = selection.selected.offer;
  if (
    !selected.supplierName ||
    !selected.sourceVerifiedAt ||
    !selected.priceVerifiedAt ||
    !isDirectResaleSourceClass(selected.sourceClass) ||
    selected.availability !== "in_stock"
  ) {
    throw new Error("PERSISTED_SUPPLIER_SELECTION_INVALID");
  }

  const prepared = prepareCommercialization(
    input.existingSpecifications,
    {
      supplierName: selected.supplierName,
      sourceClass: selected.sourceClass,
      sourceUrl: selected.sourceUrl ?? null,
      resaleAllowed: true,
      sourceVerifiedAt: selected.sourceVerifiedAt.toISOString(),
      priceVerifiedAt: selected.priceVerifiedAt.toISOString(),
      itemCostCents: selected.itemCostCents,
      shippingCents: selected.shippingCents,
      taxCents: selected.taxCents,
      supplierFeeCents: selected.supplierFeeCents,
      handlingCents: selected.handlingCents,
      sellingPriceCents: input.sellingPriceCents,
      inventoryConfidenceBps: selected.inventoryConfidenceBps,
      acquisitionReserveCents: input.acquisitionReserveCents,
      availability: "in_stock",
    },
    nowMs,
  );

  return {
    submittedSupplierId: supplier.id,
    submittedOfferId: initialOffer.id,
    submittedOfferKey: offerKey,
    selection,
    prepared: {
      ...prepared,
      specifications: annotatePersistedSelection(prepared.specifications, selected),
    },
  };
}
