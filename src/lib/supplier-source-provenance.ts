import { createHash } from "node:crypto";

export type SupplierSourceProvenanceV1 = {
  version: 1;
  verificationMethod: "owner_manual";
  supplierName: string;
  sourceClass: string;
  sourceUrl: string | null;
  resaleAllowed: true;
  verifiedAt: string;
  attestationSha256: string;
};

export type SupplierSourceProvenanceDecision = {
  allowed: boolean;
  reasons: string[];
  provenance: SupplierSourceProvenanceV1 | null;
};

const SHA256_RE = /^[a-f0-9]{64}$/i;

function clean(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function iso(value: unknown) {
  const raw = clean(value, 64);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canonicalUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const raw = clean(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function attestationPayload(input: Omit<SupplierSourceProvenanceV1, "version" | "verificationMethod" | "attestationSha256">) {
  return JSON.stringify({
    supplierName: input.supplierName,
    sourceClass: input.sourceClass,
    sourceUrl: input.sourceUrl,
    resaleAllowed: true,
    verifiedAt: input.verifiedAt,
  });
}

export function buildSupplierSourceProvenance(input: {
  supplierName: string;
  sourceClass: string;
  sourceUrl?: string | null;
  resaleAllowed: true;
  sourceVerifiedAt: string;
}): SupplierSourceProvenanceV1 {
  const supplierName = clean(input.supplierName, 160);
  const sourceClass = clean(input.sourceClass, 80);
  const verifiedAt = iso(input.sourceVerifiedAt);
  const sourceUrl = canonicalUrl(input.sourceUrl ?? null);
  if (!supplierName) throw new Error("SUPPLIER_SOURCE_PROVENANCE_NAME_INVALID");
  if (!sourceClass) throw new Error("SUPPLIER_SOURCE_PROVENANCE_CLASS_INVALID");
  if (!verifiedAt) throw new Error("SUPPLIER_SOURCE_PROVENANCE_TIMESTAMP_INVALID");
  if (input.sourceUrl && !sourceUrl) throw new Error("SUPPLIER_SOURCE_PROVENANCE_URL_INVALID");
  if (input.resaleAllowed !== true) throw new Error("SUPPLIER_SOURCE_PROVENANCE_RESALE_REQUIRED");

  const payload = { supplierName, sourceClass, sourceUrl, resaleAllowed: true as const, verifiedAt };
  return {
    version: 1,
    verificationMethod: "owner_manual",
    ...payload,
    attestationSha256: digest(attestationPayload(payload)),
  };
}

export function parseSupplierSourceProvenance(value: unknown): SupplierSourceProvenanceV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const supplierName = clean(raw.supplierName, 160);
  const sourceClass = clean(raw.sourceClass, 80);
  const verifiedAt = iso(raw.verifiedAt);
  const sourceUrl = canonicalUrl(raw.sourceUrl);
  const attestationSha256 = clean(raw.attestationSha256, 64);
  if (
    raw.version !== 1 ||
    raw.verificationMethod !== "owner_manual" ||
    !supplierName ||
    !sourceClass ||
    !verifiedAt ||
    raw.resaleAllowed !== true ||
    (raw.sourceUrl !== null && !sourceUrl) ||
    !attestationSha256 ||
    !SHA256_RE.test(attestationSha256)
  ) return null;

  const payload = { supplierName, sourceClass, sourceUrl, resaleAllowed: true as const, verifiedAt };
  if (digest(attestationPayload(payload)) !== attestationSha256.toLowerCase()) return null;
  return {
    version: 1,
    verificationMethod: "owner_manual",
    ...payload,
    attestationSha256: attestationSha256.toLowerCase(),
  };
}

export function readSupplierSourceProvenanceFromMetadata(metadata: string) {
  try {
    const root = JSON.parse(metadata) as Record<string, unknown>;
    return parseSupplierSourceProvenance(root.sourceVerificationV1);
  } catch {
    return null;
  }
}

export function bindSupplierSourceProvenanceToMetadata(metadata: string, provenance: SupplierSourceProvenanceV1) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    throw new Error("SUPPLIER_METADATA_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SUPPLIER_METADATA_INVALID");
  }
  const root = parsed as Record<string, unknown>;
  root.sourceVerificationV1 = provenance;
  return JSON.stringify(root);
}

export function bindSupplierSourceProvenanceToSpecifications(
  specifications: string,
  provenance: SupplierSourceProvenanceV1,
) {
  const root = JSON.parse(specifications) as Record<string, unknown>;
  const raw = root.supplierOfferV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("COMMERCIALIZATION_SNAPSHOT_INVALID");
  root.supplierOfferV1 = {
    ...(raw as Record<string, unknown>),
    sourceVerificationV1: provenance,
  };
  return JSON.stringify(root);
}

export function supplierSourceProvenanceBindingRequired() {
  const configured = process.env.SUPPLIER_SOURCE_PROVENANCE_REQUIRED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function evaluateSupplierSourceProvenance(
  metadata: string,
  expected: {
    supplierName: string;
    sourceClass: string;
    sourceUrl: string | null;
    resaleAllowed: boolean;
    sourceVerifiedAt: Date | null;
    verificationSource?: string | null;
  },
): SupplierSourceProvenanceDecision {
  const provenance = readSupplierSourceProvenanceFromMetadata(metadata);
  const reasons: string[] = [];
  if (!provenance) {
    reasons.push("supplier_source_provenance_missing_or_invalid");
    return { allowed: false, reasons, provenance: null };
  }
  if (expected.verificationSource && expected.verificationSource !== provenance.verificationMethod) {
    reasons.push("supplier_source_provenance_method_drift");
  }
  if (expected.supplierName.trim().replace(/\s+/g, " ") !== provenance.supplierName) {
    reasons.push("supplier_source_provenance_name_drift");
  }
  if (expected.sourceClass.trim() !== provenance.sourceClass) reasons.push("supplier_source_provenance_class_drift");
  if (canonicalUrl(expected.sourceUrl) !== provenance.sourceUrl) reasons.push("supplier_source_provenance_url_drift");
  if (expected.resaleAllowed !== true || provenance.resaleAllowed !== true) reasons.push("supplier_source_provenance_resale_drift");
  if (!expected.sourceVerifiedAt || expected.sourceVerifiedAt.toISOString() !== provenance.verifiedAt) {
    reasons.push("supplier_source_provenance_timestamp_drift");
  }
  return { allowed: reasons.length === 0, reasons, provenance };
}

export function sameSupplierSourceProvenance(
  left: SupplierSourceProvenanceV1 | null | undefined,
  right: SupplierSourceProvenanceV1 | null | undefined,
) {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right));
}
