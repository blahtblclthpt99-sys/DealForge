import {
  isSameOriginProcurementMutation,
  requireProcurementOwner,
} from "@/lib/procurement-authorization";

/**
 * Refunds move customer money and can change post-purchase recovery exposure,
 * so they use the same configured owner identity as procurement operations.
 */
export const requireRefundOwner = requireProcurementOwner;
export const isSameOriginRefundMutation = isSameOriginProcurementMutation;
