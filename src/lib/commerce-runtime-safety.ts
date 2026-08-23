import {
  checkDirectCommerceReadiness,
  type DirectCommerceReadinessInput,
  type DirectCommerceReadinessResult,
} from "@/lib/direct-commerce-readiness";
import {
  checkRecommendationSourceBinding,
  type CommerceSourceBindingInput,
  type CommerceSourceBindingResult,
} from "@/lib/commerce-source-binding";

export type DirectCommerceSafetyReason =
  | DirectCommerceReadinessResult["reason"]
  | CommerceSourceBindingResult["reason"];

export type DirectCommerceSafetyInput = DirectCommerceReadinessInput &
  Pick<CommerceSourceBindingInput, "retailer" | "sourceUrl" | "asin">;

export type DirectCommerceSafetyResult = {
  safe: boolean;
  reason: DirectCommerceSafetyReason;
  readiness: DirectCommerceReadinessResult;
  sourceBinding: CommerceSourceBindingResult | null;
};

export function checkDirectCommerceProductSafety(
  input: DirectCommerceSafetyInput,
): DirectCommerceSafetyResult {
  const readiness = checkDirectCommerceReadiness(input);
  if (!readiness.ready) {
    return {
      safe: false,
      reason: readiness.reason,
      readiness,
      sourceBinding: null,
    };
  }

  const sourceBinding = checkRecommendationSourceBinding({
    retailer: input.retailer,
    sourceUrl: input.sourceUrl,
    asin: input.asin,
    specifications: input.specifications,
  });
  if (!sourceBinding.bound) {
    return {
      safe: false,
      reason: sourceBinding.reason,
      readiness,
      sourceBinding,
    };
  }

  return {
    safe: true,
    reason: "READY",
    readiness,
    sourceBinding,
  };
}
