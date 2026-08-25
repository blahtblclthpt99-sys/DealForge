import { prisma } from "./db";
import {
  evaluateDirectResaleSourceAuthorization,
  type DirectResaleSourceAuthorizationDecision,
} from "./source-policy";

const MAX_SOURCE_KEY_LENGTH = 180;

export type PersistedSupplierSourceAuthorization = {
  sourceKey: string;
  supplierId: string | null;
  allowed: boolean;
  reasons: string[];
};

function normalizeSourceKey(value: string) {
  const sourceKey = value.trim();
  if (!sourceKey || sourceKey.length > MAX_SOURCE_KEY_LENGTH) return null;
  return sourceKey;
}

export function evaluatePersistedSupplierSourceAuthorization(
  supplier: {
    active: boolean;
    sourceClass: string;
    resaleAllowed: boolean;
    sourceVerifiedAt: Date | null;
  } | null,
  nowMs = Date.now(),
): DirectResaleSourceAuthorizationDecision {
  if (!supplier) return { allowed: false, reasons: ["source_not_found"] };
  return evaluateDirectResaleSourceAuthorization(supplier, nowMs);
}

/**
 * Resolve current persisted authorization for a normalized supplier source.
 * Adapter credentials are intentionally not considered here: a cryptographic
 * credential can prove identity, but it cannot override live DealForge source
 * authorization, resale permission, source class, or verification freshness.
 */
export async function loadPersistedSupplierSourceAuthorization(
  value: string,
  nowMs = Date.now(),
): Promise<PersistedSupplierSourceAuthorization> {
  const sourceKey = normalizeSourceKey(value);
  if (!sourceKey) {
    return { sourceKey: "", supplierId: null, allowed: false, reasons: ["source_key_invalid"] };
  }

  const supplier = await prisma.supplier.findUnique({
    where: { key: sourceKey },
    select: {
      id: true,
      active: true,
      sourceClass: true,
      resaleAllowed: true,
      sourceVerifiedAt: true,
    },
  });
  const decision = evaluatePersistedSupplierSourceAuthorization(supplier, nowMs);
  return {
    sourceKey,
    supplierId: supplier?.id ?? null,
    allowed: decision.allowed,
    reasons: decision.reasons,
  };
}

export async function requirePersistedSupplierSourceAuthorization(
  sourceKey: string,
  errorCode: string,
  nowMs = Date.now(),
) {
  const decision = await loadPersistedSupplierSourceAuthorization(sourceKey, nowMs);
  if (!decision.allowed) throw new Error(errorCode);
  return decision;
}
