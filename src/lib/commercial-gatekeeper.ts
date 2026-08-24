import { prisma } from "@/lib/db";
import { evaluateCommerceGate } from "@/lib/commerce-gate";

export async function reviewPublishedProductForCommerce(productId: string, actor: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
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
  if (!product) throw new Error("PRODUCT_NOT_FOUND");

  const candidate = await prisma.productCandidate.findFirst({
    where: { publishedProductId: product.id },
    select: { id: true, state: true },
  });

  const decision = evaluateCommerceGate(product);
  const nextState = decision.allowed ? "commerce_ready" : "commercial_blocked";

  if (candidate) {
    await prisma.$transaction([
      prisma.productCandidate.update({
        where: { id: candidate.id },
        data: {
          state: nextState,
          rejectionReason: decision.allowed ? null : decision.reasons.join(","),
        },
      }),
      prisma.productEngineAudit.create({
        data: {
          candidateId: candidate.id,
          actor,
          action: decision.allowed ? "commercial_gate_passed" : "commercial_gate_blocked",
          fromState: candidate.state,
          toState: nextState,
          detail: JSON.stringify({
            productId: product.id,
            reasons: decision.reasons,
            sourceClass: decision.sourceClass,
            contributionProfitCents: decision.contributionProfitCents,
            contributionMarginBps: decision.contributionMarginBps,
            reserveTotalCents: decision.reserveTotalCents,
          }),
        },
      }),
    ]);
  } else {
    await prisma.productEngineAudit.create({
      data: {
        candidateId: null,
        actor,
        action: decision.allowed ? "commercial_gate_passed" : "commercial_gate_blocked",
        detail: JSON.stringify({
          productId: product.id,
          reasons: decision.reasons,
          sourceClass: decision.sourceClass,
          contributionProfitCents: decision.contributionProfitCents,
          contributionMarginBps: decision.contributionMarginBps,
          reserveTotalCents: decision.reserveTotalCents,
          candidateMissing: true,
        }),
      },
    });
  }

  return {
    productId: product.id,
    candidateId: candidate?.id ?? null,
    state: nextState,
    ...decision,
  };
}
