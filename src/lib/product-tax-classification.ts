export const DEFAULT_TAX_CLASSIFICATION_MAX_AGE_DAYS = 365;

export type ProductTaxClassification = {
  stripeTaxCode: string;
  classification: string;
  verifiedAt: string;
  verificationSource: string;
  maxAgeDays: number;
};

export type ProductTaxClassificationDecision = {
  allowed: boolean;
  reasons: string[];
  classification: ProductTaxClassification | null;
};

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isValidStripeTaxCode(value: unknown): value is string {
  return typeof value === "string" && /^txcd_[A-Za-z0-9]+$/.test(value.trim());
}

export function readProductTaxClassification(specifications: string): ProductTaxClassification | null {
  try {
    const root = JSON.parse(specifications) as Record<string, unknown>;
    const raw = root.taxV1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const tax = raw as Record<string, unknown>;

    const stripeTaxCode = isValidStripeTaxCode(tax.stripeTaxCode)
      ? tax.stripeTaxCode.trim()
      : null;
    const classification = typeof tax.classification === "string" ? tax.classification.trim() : "";
    const verifiedAt = typeof tax.verifiedAt === "string" ? tax.verifiedAt.trim() : "";
    const verificationSource = typeof tax.verificationSource === "string"
      ? tax.verificationSource.trim()
      : "";
    const maxAgeDays = typeof tax.maxAgeDays === "number" && Number.isSafeInteger(tax.maxAgeDays)
      ? tax.maxAgeDays
      : DEFAULT_TAX_CLASSIFICATION_MAX_AGE_DAYS;

    if (!stripeTaxCode || !classification || !verificationSource) return null;
    if (parseTimestamp(verifiedAt) === null) return null;
    if (maxAgeDays < 1 || maxAgeDays > 3650) return null;

    return {
      stripeTaxCode,
      classification,
      verifiedAt,
      verificationSource,
      maxAgeDays,
    };
  } catch {
    return null;
  }
}

export function evaluateProductTaxClassification(
  specifications: string,
  nowMs = Date.now(),
): ProductTaxClassificationDecision {
  const reasons: string[] = [];
  const classification = readProductTaxClassification(specifications);

  if (!classification) {
    return {
      allowed: false,
      reasons: ["tax_classification_missing_or_invalid"],
      classification: null,
    };
  }

  const verifiedAt = parseTimestamp(classification.verifiedAt);
  if (verifiedAt === null || verifiedAt > nowMs + 5 * 60_000) {
    reasons.push("tax_classification_verification_invalid");
  } else if (nowMs - verifiedAt > classification.maxAgeDays * 86_400_000) {
    reasons.push("tax_classification_stale");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    classification,
  };
}
