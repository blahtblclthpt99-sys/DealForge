import { prisma } from "./db";
import { evaluateCommerceGate, type CommerceGateDecision } from "./commerce-gate";

const CERTIFICATION_PRODUCT_ID = "cert_test_75c_20260822_v2";

export type CommerceMonitorProduct = {
  id: string;
  commerceEnabled: boolean;
  availability: string;
  sellingPriceCents: number | null;
  landedCostCents: number | null;
  priceVerifiedAt: Date | null;
  specifications: string;
};

export type CommerceMonitorEvaluation = {
  certification: boolean;
  decision: CommerceGateDecision | null;
};

function isInternalCertificationProduct(product: Pick<CommerceMonitorProduct, "id" | "specifications">) {
  if (product.id === CERTIFICATION_PRODUCT_ID) return true;
  try {
    const root = JSON.parse(product.specifications) as { internalCertification?: unknown };
    return root.internalCertification === true;
  } catch {
    return false;
  }
}

export function evaluateCommerceMonitorProduct(
  product: CommerceMonitorProduct,
  nowMs = Date.now(),
): CommerceMonitorEvaluation {
  if (isInternalCertificationProduct(product)) {
    return { certification: true, decision: null };
  }

  return {
    certification: false,
    decision: evaluateCommerceGate(
      {
        commerceEnabled: product.commerceEnabled,
        availability: product.availability,
        sellingPriceCents: product.sellingPriceCents,
        landedCostCents: product.landedCostCents,
        priceVerifiedAt: product.priceVerifiedAt,
        specifications: product.specifications,
      },
      nowMs,
    ),
  };
}

/**
 * Re-check every product that is currently marked commerce-enabled.
 * This worker is deliberately one-way: it may pause an unsafe product, but it
 * never enables or automatically resumes commerce. Re-enablement requires a
 * fresh owner commercialization action and the complete profit gate.
 */
export async function pauseUnsafeCommerceProducts(actor = "commerce-monitor", nowMs = Date.now()) {
  const products = await prisma.product.findMany({
    where: { commerceEnabled: true },
    select: {
      id: true,
      commerceEnabled: true,
      availability: true,
      sellingPriceCents: true,
      landedCostCents: true,
      priceVerifiedAt: true,
      specifications: true,
    },
  });

  let paused = 0;
  let certificationSkipped = 0;

  for (const product of products) {
    const evaluation = evaluateCommerceMonitorProduct(product, nowMs);
    if (evaluation.certification) {
      certificationSkipped += 1;
      continue;
    }
    const decision = evaluation.decision;
    if (!decision || decision.allowed) continue;

    // Conditional update prevents duplicate pause/audit records if multiple
    // workers race on the same product.
    const result = await prisma.product.updateMany({
      where: { id: product.id, commerceEnabled: true },
      data: { commerceEnabled: false },
    });
    if (result.count !== 1) continue;

    paused += 1;
    await prisma.productEngineAudit.create({
      data: {
        candidateId: null,
        actor,
        action: "commerce_auto_paused",
        detail: JSON.stringify({
          productId: product.id,
          reasons: decision.reasons,
          contributionProfitCents: decision.contributionProfitCents,
          contributionMarginBps: decision.contributionMarginBps,
          reserveTotalCents: decision.reserveTotalCents,
          sourceClass: decision.sourceClass,
        }),
      },
    });
  }

  if (paused > 0) {
    await prisma.systemLog.create({
      data: {
        level: "warn",
        source: "commerce-monitor",
        message: `Automatically paused ${paused} unsafe commerce product${paused === 1 ? "" : "s"}`,
        meta: JSON.stringify({ checked: products.length, paused, certificationSkipped }),
      },
    });
  }

  return { checked: products.length, paused, certificationSkipped };
}
