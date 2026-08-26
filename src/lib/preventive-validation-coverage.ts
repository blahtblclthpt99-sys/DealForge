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
  { reason: "supplier_cost_verification_invalid", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Missing, invalid, or future supplier-price verification fails closed." },
  { reason: "supplier_cost_verification_stale", domain: "supplier", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Supplier price age is bounded before commerce can pass." },
  { reason: "supplier_not_eligible", domain: "supplier", status: "persisted_selection", stage: "persisted supplier selection", validator: "selectPersistedSupplierOffer", source: "src/lib/supplier-commercialization.ts", note: "Persisted selection must return an eligible offer or the product is kept commerce-disabled." },

  { reason: "inventory_not_in_stock", domain: "inventory", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Non-stock availability fails before commerce is permitted." },
  { reason: "inventory_confidence_below_floor", domain: "inventory", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Inventory confidence is compared with the minimum policy floor before commerce." },
  { reason: "inventory_observation_missing", domain: "inventory", status: "runtime_monitor", stage: "inventory freshness", validator: "evaluateInventoryFreshness", source: "src/lib/inventory-freshness.ts", note: "Fresh-observation enforcement exists, but the owner commercialization input does not yet bind a specific InventoryObservation record." },
  { reason: "inventory_observation_stale", domain: "inventory", status: "runtime_monitor", stage: "inventory freshness", validator: "evaluateInventoryFreshness", source: "src/lib/inventory-freshness.ts", note: "Expired observations are rejected by freshness monitoring; explicit pre-publication observation binding remains a coverage opportunity." },
  { reason: "inventory_observation_invalid", domain: "inventory", status: "runtime_monitor", stage: "inventory freshness", validator: "evaluateInventoryFreshness", source: "src/lib/inventory-freshness.ts", note: "Malformed observation timestamps or evidence fail freshness evaluation." },
  { reason: "inventory_confidence_low", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy/alternate operational alias; canonical active validator emits inventory_confidence_below_floor." },
  { reason: "inventory_out_of_stock", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy/alternate operational alias; canonical active gate emits inventory_not_in_stock." },
  { reason: "inventory_missing", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for recovery compatibility." },
  { reason: "inventory_stale", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for recovery compatibility; canonical freshness reason is inventory_observation_stale." },
  { reason: "inventory_not_current", domain: "inventory", status: "legacy_alias", stage: "recovery normalization", validator: "commerce quarantine recovery guidance", source: "src/lib/commerce-quarantine.ts", note: "Legacy reason retained for historical audits." },

  { reason: "selling_price_invalid", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Selling price must be a positive safe integer." },
  { reason: "landed_cost_invalid", domain: "cost_profit", status: "preflight", stage: "commercialization + commerce gate", validator: "costs / evaluateCommerceGate", source: "src/lib/commercialization.ts + src/lib/commerce-gate.ts", note: "Landed cost is recalculated from validated components and must remain valid." },
  { reason: "contribution_profit_below_floor", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Minimum safe contribution profit is enforced before commerce." },
  { reason: "contribution_margin_below_floor", domain: "cost_profit", status: "preflight", stage: "commerce gate", validator: "evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Minimum contribution margin is enforced before commerce." },
  { reason: "observed_supplier_price_drift", domain: "cost_profit", status: "runtime_monitor", stage: "supplier/inventory monitoring", validator: "operational drift monitoring", source: "commerce monitoring path", note: "Drift is inherently post-verification; remediation requires cost refresh and a new profit gate." },

  { reason: "commercial_policy_missing_or_invalid", domain: "policy", status: "preflight", stage: "commerce gate", validator: "parsePolicy / evaluateCommerceGate", source: "src/lib/commerce-gate.ts", note: "Malformed or incomplete commerce policy returns an immediate fail-closed decision." },
  { reason: "safety_evidence_requires_review", domain: "other", status: "unmapped", stage: "quarantine fallback", validator: "deriveCommerceQuarantineRecords", source: "src/lib/commerce-quarantine.ts", note: "Fallback reason is intentionally generic; the originating evidence contract must be identified before adding an automatic validator." },
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
