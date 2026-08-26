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
import {
  bindInventoryEvidenceToSpecifications,
  inventoryEvidenceBindingRequired,
  resolveCurrentInventoryEvidence,
} from "./inventory-evidence-binding";
import { resolveOperationalCartPricingPolicy } from "./loss-reserve-policy";
import { isDirectResaleSourceClass } from "./source-policy";
import {
  bindSupplierSourceProvenanceToMetadata,
  bindSupplierSourceProvenanceToSpecifications,
  buildSupplierSourceProvenance,
  evaluateSupplierSourceProvenance,
  readSupplierSourceProvenanceFromMetadata,
  sameSupplierSourceProvenance,
} from "./supplier-source-provenance";
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
  taxClassification: string;
  stripeTaxCode: string;
  taxVerifiedAt: string;
  taxVerificationSource: string;
  taxMaxAgeDays?: number;
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

type ComparableOfferObservation = {
  sourceUrl: string | null;
  availability: string;
  currency: string;
  itemCostCents: number;
  shippingCents: number;
  taxCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  inventoryConfidenceBps: number;
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
  current: ComparableOfferObservation,
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

function unavailableSnapshotAvailability(selection: SupplierSelectionResult) {
  return selection.evaluated.length > 0 && selection.evaluated.every((entry) => entry.offer.availability === "out_of_stock")
    ? "out_of_stock"
    : "unknown";
}

async function readCurrentOffer(id: string) {
  return prisma.supplierOffer.findUnique({
    where: { id },
    select: {
      id: true,
      supplierId: true,
      productId: true,
      sourceUrl: true,
      availability: true,
      currency: true,
      itemCostCents: true,
      shippingCents: true,
      taxCents: true,
      supplierFeeCents: true,
      handlingCents: true,
      priceVerifiedAt: true,
      inventoryConfidenceBps: true,
    },
  });
}

function taxInput(input: PersistedCommercializationInput) {
  return {
    taxClassification: input.taxClassification,
    stripeTaxCode: input.stripeTaxCode,
    taxVerifiedAt: input.taxVerifiedAt,
    taxVerificationSource: input.taxVerificationSource,
    taxMaxAgeDays: input.taxMaxAgeDays,
  };
}

function selectionBlockedBySourceProvenance(
  selection: SupplierSelectionResult,
  selectedSupplierId: string,
  reasons: string[],
): SupplierSelectionResult {
  return {
    selected: null,
    evaluated: selection.evaluated.map((entry) =>
      entry.offer.supplierId === selectedSupplierId
        ? { ...entry, eligible: false, reasons: [...new Set([...entry.reasons, ...reasons])] }
        : entry,
    ),
  };
}

export async function persistSelectAndPrepareCommercialization(
  input: PersistedCommercializationInput,
  nowMs = Date.now(),
): Promise<PersistedCommercializationResult> {
  const productId = input.productId.trim();
  if (!productId || productId.length > 128) throw new Error("PRODUCT_ID_INVALID");

  const currency = input.productCurrency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new Error("PRODUCT_CURRENCY_INVALID");
  const pricingPolicy = (await resolveOperationalCartPricingPolicy(currency, nowMs)).policy;

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
      ...taxInput(input),
    },
    nowMs,
    pricingPolicy,
  );
  const snapshot = canonicalSnapshot(submittedPreflight.specifications);
  const sourceVerifiedAt = new Date(snapshot.sourceVerifiedAt);
  const priceVerifiedAt = new Date(snapshot.priceVerifiedAt);
  const supplierName = input.supplierName.trim().replace(/\s+/g, " ");
  const supplierKey = supplierPersistenceKey(supplierName, input.sourceClass);
  const offerKey = supplierOfferPersistenceKey(productId, supplierKey, snapshot.sourceUrl);
  const websiteUrl = snapshot.sourceUrl ? new URL(snapshot.sourceUrl).origin : null;
  const submittedSourceProvenance = buildSupplierSourceProvenance({
    supplierName,
    sourceClass: input.sourceClass,
    sourceUrl: websiteUrl,
    resaleAllowed: true,
    sourceVerifiedAt: sourceVerifiedAt.toISOString(),
  });

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
      verificationSource: submittedSourceProvenance.verificationMethod,
      metadata: bindSupplierSourceProvenanceToMetadata("{}", submittedSourceProvenance),
    },
    update: { name: supplierName, websiteUrl: websiteUrl ?? undefined },
  });
  if (supplier.sourceClass !== input.sourceClass) throw new Error("SUPPLIER_KEY_CONFLICT");

  const supplierVerifiedAtMs = supplier.sourceVerifiedAt?.getTime() ?? null;
  const submittedVerifiedAtMs = sourceVerifiedAt.getTime();
  const existingSourceProvenance = readSupplierSourceProvenanceFromMetadata(supplier.metadata);
  if (
    supplierVerifiedAtMs === submittedVerifiedAtMs &&
    existingSourceProvenance &&
    !sameSupplierSourceProvenance(existingSourceProvenance, submittedSourceProvenance)
  ) {
    throw new Error("SUPPLIER_SOURCE_VERIFICATION_CONFLICT");
  }

  if (supplierVerifiedAtMs === null || supplierVerifiedAtMs <= submittedVerifiedAtMs) {
    const nextMetadata = bindSupplierSourceProvenanceToMetadata(supplier.metadata, submittedSourceProvenance);
    await prisma.supplier.updateMany({
      where: {
        id: supplier.id,
        OR: [{ sourceVerifiedAt: null }, { sourceVerifiedAt: { lt: sourceVerifiedAt } }, { sourceVerifiedAt }],
      },
      data: {
        sourceVerifiedAt,
        verificationSource: submittedSourceProvenance.verificationMethod,
        metadata: nextMetadata,
        active: true,
        resaleAllowed: true,
      },
    });
  }

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
    update: {},
  });
  if (initialOffer.supplierId !== supplier.id || initialOffer.productId !== productId) {
    throw new Error("SUPPLIER_OFFER_KEY_CONFLICT");
  }

  const currentPriceVerifiedAt = initialOffer.priceVerifiedAt?.getTime() ?? null;
  if (
    currentPriceVerifiedAt === priceVerifiedAt.getTime() &&
    !sameOfferObservation(initialOffer, input, snapshot.sourceUrl, currency)
  ) throw new Error("SUPPLIER_OFFER_VERIFICATION_CONFLICT");

  if (currentPriceVerifiedAt === null || currentPriceVerifiedAt < priceVerifiedAt.getTime()) {
    const advanced = await prisma.supplierOffer.updateMany({
      where: { id: initialOffer.id, OR: [{ priceVerifiedAt: null }, { priceVerifiedAt: { lt: priceVerifiedAt } }] },
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
    if (advanced.count === 0) {
      const winner = await readCurrentOffer(initialOffer.id);
      if (!winner) throw new Error("SUPPLIER_OFFER_UPDATE_RACE");
      const winnerVerifiedAt = winner.priceVerifiedAt?.getTime() ?? null;
      if (
        winnerVerifiedAt === priceVerifiedAt.getTime() &&
        !sameOfferObservation(winner, input, snapshot.sourceUrl, currency)
      ) throw new Error("SUPPLIER_OFFER_VERIFICATION_CONFLICT");
    }
  }

  let selection = await selectPersistedSupplierOffer(
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
    await prisma.product.update({
      where: { id: productId },
      data: { commerceEnabled: false, availability: unavailableSnapshotAvailability(selection) },
    });
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
  ) throw new Error("PERSISTED_SUPPLIER_SELECTION_INVALID");

  const selectedSupplierState = await prisma.supplier.findUnique({
    where: { id: selected.supplierId },
    select: {
      name: true,
      sourceClass: true,
      websiteUrl: true,
      resaleAllowed: true,
      sourceVerifiedAt: true,
      verificationSource: true,
      metadata: true,
    },
  });
  const sourceProvenanceDecision = selectedSupplierState
    ? evaluateSupplierSourceProvenance(selectedSupplierState.metadata, {
        supplierName: selectedSupplierState.name,
        sourceClass: selectedSupplierState.sourceClass,
        sourceUrl: selectedSupplierState.websiteUrl,
        resaleAllowed: selectedSupplierState.resaleAllowed,
        sourceVerifiedAt: selectedSupplierState.sourceVerifiedAt,
        verificationSource: selectedSupplierState.verificationSource,
      })
    : { allowed: false, reasons: ["supplier_source_provenance_missing_or_invalid"], provenance: null };

  if (!sourceProvenanceDecision.allowed || !sourceProvenanceDecision.provenance) {
    selection = selectionBlockedBySourceProvenance(selection, selected.supplierId, sourceProvenanceDecision.reasons);
    await prisma.product.update({
      where: { id: productId },
      data: { commerceEnabled: false, availability: "unknown" },
    });
    return {
      submittedSupplierId: supplier.id,
      submittedOfferId: initialOffer.id,
      submittedOfferKey: offerKey,
      selection,
      prepared: null,
    };
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
      ...taxInput(input),
    },
    nowMs,
    pricingPolicy,
  );

  let specifications = annotatePersistedSelection(prepared.specifications, selected);
  specifications = bindSupplierSourceProvenanceToSpecifications(
    specifications,
    sourceProvenanceDecision.provenance,
  );
  if (inventoryEvidenceBindingRequired()) {
    const inventory = await resolveCurrentInventoryEvidence(selected.id, selected.itemCostCents, nowMs);
    if (!inventory.allowed || !inventory.evidence) {
      await prisma.product.update({
        where: { id: productId },
        data: { commerceEnabled: false, availability: "unknown" },
      });
      return {
        submittedSupplierId: supplier.id,
        submittedOfferId: initialOffer.id,
        submittedOfferKey: offerKey,
        selection,
        prepared: null,
      };
    }
    specifications = bindInventoryEvidenceToSpecifications(specifications, selected.id, inventory.evidence);
  }

  return {
    submittedSupplierId: supplier.id,
    submittedOfferId: initialOffer.id,
    submittedOfferKey: offerKey,
    selection,
    prepared: { ...prepared, specifications },
  };
}
