export type ValidationCoverageStatus = "preflight" | "persisted_selection" | "runtime_monitor" | "legacy_alias" | "unmapped";

export type ValidationCoverageEntry = {
  reason: string;
  domain: "tax" | "supplier" | "inventory" | "cost_profit" | "policy" | "other";
  status: ValidationCoverageStatus;
  stage: string;
  validator: string;
  source: string;
  note: string;
};

const entries: ValidationCoverageEntry[] = [
  { reason: "tax_classification_missing_or_invalid", domain: "tax", status: "preflight", stage: "owner commercialization", validator: "prepareCommercialization", source: "src/lib/commercialization.ts", note: "Tax classification, Stripe tax code, verification source, timestamp, and age are validated before commerce state is prepared." },
  { reason: "tax_classification_verification_invalid", domain: "tax", status: "preflight", stage: "tax classification", validator: "product tax classification + commercialization", source: "src/lib/product-tax-classification.ts", note: "Authoritative tax evidence is validated before commercialization; quarantine reason is the normalized operational form." },
  { reason: "tax_classification_stale", domain: "tax", status: "preflight", stage: "owner commercialization", validator: "prepareCommercialization", source: "src/lib/commercialization.ts", note: "Stale tax evidence throws before the commercialization bundle is produced." },

  { reason: "source_class_not_direct_resale", domain: "supplier", status: "preflight", stage: "owner commercialization", validator: "prepareCommercialization / evaluateCommerceGate", source: "src/lib/commercialization.ts + src/lib/commerce-gate.ts", note: "Only direct-resale source classes can pass commercialization." },
  { reason: "resale_not_verified", domain: "supplier", status: "preflight", stage: "owner commercialization", validator: "prepareCommercialization / evaluateCommerceGate", source: "src/lib/commercialization.ts + src/lib/commerce-gate.ts", note: "Resale authorization is mandatory and fails closed." },
  { reason: "source_verification_invalid", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Invalid or future-dated source verification cannot pass the gate." },
  { reason: "source_verification_stale", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Source verification age is bounded before commerce can be enabled." },
  { reason: "supplier_source_provenance_missing_or_invalid", domain: "supplier", status: "preflight", stage: "persisted commercialization", validator: "evaluateSupplierSourceProvenance", source: "src/lib/supplier-source-provenance.ts + src/lib/supplier-commercialization.ts", note: "The selected Supplier must carry a valid versioned source-verification attestation fingerprint before commercialization can bind it into product state." },
  { reason: "persisted_source_provenance_missing_or_invalid", domain: "supplier", status: "preflight", stage: "checkout/storefront source binding", validator: "evaluatePersistedOfferBinding", source: "src/lib/persisted-offer-binding.ts", note: "Production customer-money paths require the frozen product snapshot to contain valid supplier source provenance." },
  { reason: "persisted_source_provenance_drift", domain: "supplier", status: "preflight", stage: "checkout/storefront source binding", validator: "evaluatePersistedOfferBinding", source: "src/lib/persisted-offer-binding.ts", note: "The frozen source attestation fingerprint must still equal the live Supplier metadata before a product can be represented or purchased as current." },
  { reason: "supplier_cost_verification_invalid", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Missing, invalid, or future supplier-offer price verification fails closed; Product.priceVerifiedAt cannot substitute for the persisted supplier timestamp." },
  { reason: "supplier_cost_verification_stale", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Supplier cost freshness is measured only from persisted supplierOfferV1.priceVerifiedAt before commerce can pass." },
  { reason: "product_price_verification_drift", domain: "supplier", status: "preflight", stage: "commerce gate provenance mirror", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "When the Product priceVerifiedAt provenance mirror is present it must exactly match the authoritative persisted supplier-offer timestamp." },
  { reason: "supplier_not_eligible", domain: "supplier", status: "persisted_selection", stage: "persisted supplier selection", validator: "selectPersistedSupplierOffer", source: "src/lib/supplier-commercialization.ts", note: "Persisted selection must return an eligible offer or the product is kept commerce-disabled." },

  { reason: "inventory_not_in_stock", domain: "inventory", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Non-stock availability fails before commerce is permitted." },
  { reason: "inventory_confidence_below_floor", domain: "inventory", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Inventory confidence is compared with the minimum policy floor before commerce." },
  { reason: "inventory_observation_missing", domain: "inventory", status: "preflight", stage: "persisted commercialization", validator: "resolveCurrentInventoryEvidence", source: "src/lib/inventory-evidence-binding.ts + src/lib/supplier-commercialization.ts", note: "Production commercialization now requires an exact current InventoryObservation for the selected persisted supplier offer." },
  { reason: "inventory_observation_stale", domain: "inventory", status: "preflight", stage: "persisted commercialization", validator: "resolveCurrentInventoryEvidence", source: "src/lib/inventory-evidence-binding.ts + src/lib/supplier-commercialization.ts", note: "Expired InventoryObservation evidence blocks commercialization before commerce state can be prepared." },
  { reason: "inventory_observation_invalid", domain: "inventory", status: "preflight", stage: "persisted commercialization", validator: "resolveCurrentInventoryEvidence", source: "src/lib/inventory-evidence-binding.ts + src/lib/supplier-commercialization.ts", note: "Malformed or non-serializable exact-offer inventory evidence blocks commercialization and cannot enter the immutable order source snapshot." },
  { reason: "inventory_confidence_low", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy/alternate operational alias; canonical active validator emits inventory_confidence_below_floor." },
  { reason: "inventory_out_of_stock", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy/alternate operational alias; canonical active gate emits inventory_not_in_stock." },
  { reason: "inventory_missing", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for recovery compatibility." },
  { reason: "inventory_stale", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for recovery compatibility; canonical freshness reason is inventory_observation_stale." },
  { reason: "inventory_not_current", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for historical audits." },

  { reason: "selling_price_invalid", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Selling price must be a positive safe integer." },
  { reason: "landed_cost_invalid", domain: "cost_profit", status: "preflight", stage: "commercialization + commerce gate", validator: "costs / evaluateCommerceGate", source: "src/lib/commercialization.ts + src/lib/commerce-gate.ts", note: "Landed cost is recalculated from validated components and must remain valid." },
  { reason: "contribution_profit_below_floor", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Minimum safe contribution profit is enforced before commerce." },
  { reason: "contribution_margin_below_floor", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Minimum contribution margin is enforced before commerce." },
  { reason: "observed_supplier_price_drift", domain: "cost_profit", status: "preflight", stage: "exact inventory evidence binding", validator: "evaluateInventoryEvidenceBinding", source: "src/lib/inventory-evidence-binding.ts", note: "A current InventoryObservation with a conflicting observed supplier price blocks production commercialization before the source snapshot is accepted; runtime monitoring remains a second line of defense." },

  { reason: "commercial_policy_missing_or_invalid", domain: "policy", status: "preflight", stage: "commerce gate", validator: "parsePolicy / evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Malformed or incomplete commerce policy returns an immediate fail-closed decision." },
  { reason: "safety_evidence_requires_review", domain: "other", status: "unmapped", stage: "quarantine fallback", validator: "deriveCommerceQuarantineRecords", source: "src/lib/commerce-quarantine.ts", note: "Defensive fallback retained for malformed or historical audit records without concrete reasons; current quarantine writers emit explicit reason arrays." },
];

export function preventiveValidationCoverage() {
  return [...entries];
}

export function summarizeValidationCoverage(input = entries) {
  return input.reduce((summary, entry) => {
    summary.total += 1;
    summary[entry.status] += 1;
    return summary;
  }, { total: 0, preflight: 0, persisted_selection: 0, runtime_monitor: 0, legacy_alias: 0, unmapped: 0 });
}
