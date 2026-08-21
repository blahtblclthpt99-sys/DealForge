import nextWorker from "../.open-next/worker.js";
import { runMaintenanceOnce } from "../src/workers/maintenance.ts";

// Preserve any named exports emitted by OpenNext (for example Durable Object
// classes) while wrapping only the default handler.
export * from "../.open-next/worker.js";

export default {
  fetch(request, env, ctx) {
    return nextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller) {
    const startedAt = Date.now();
    try {
      // Public discovery already ranks directly from click/view/recency fields,
      // so the legacy full-catalog trending rewrite is intentionally omitted
      // from the Cloudflare cron path. It performs tens of thousands of writes
      // and is unnecessary for storefront ordering.
      const result = await runMaintenanceOnce({
        priceRefreshLimit: 20,
        refreshTrending: false,
        expireFlashDeals: true,
        cleanCache: true,
        processPriceAlerts: true,
      });
      console.log(
        JSON.stringify({
          event: "dealforge-maintenance",
          cron: controller.cron,
          durationMs: Date.now() - startedAt,
          ...result,
        }),
      );
    } catch (error) {
      console.error("DealForge scheduled maintenance failed", error);
      throw error;
    }
  },
};
