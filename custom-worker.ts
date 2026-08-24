// OpenNext generates this module during the Cloudflare build.
// @ts-ignore generated at build time
import nextWorker from "./.open-next/worker.js";

type DealForgeEnv = {
  MAINTENANCE_TOKEN?: string;
  AUTH_SECRET?: string;
};

type ScheduledEvent = {
  cron: string;
  scheduledTime: number;
};

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type NextWorker = {
  fetch(request: Request, env: DealForgeEnv, ctx: WorkerContext): Promise<Response>;
};

const handler = nextWorker as NextWorker;

export default {
  fetch: handler.fetch,

  async scheduled(_event: ScheduledEvent, env: DealForgeEnv, ctx: WorkerContext) {
    const token = (env.MAINTENANCE_TOKEN || env.AUTH_SECRET || "").trim();
    if (token.length < 24) {
      console.error("commerce.monitor.cron_not_configured");
      return;
    }

    const request = new Request("https://www.deal-forge.sale/api/internal/commerce-monitor", {
      method: "POST",
      headers: {
        "x-dealforge-maintenance-token": token,
        "content-type": "application/json",
      },
      body: "{}",
    });

    ctx.waitUntil(
      handler.fetch(request, env, ctx).then(async (response) => {
        if (!response.ok) {
          const body = (await response.text()).slice(0, 500);
          throw new Error(`COMMERCE_MONITOR_HTTP_${response.status}:${body}`);
        }
      }),
    );
  },
};

// Re-export OpenNext durable objects if cache configuration uses them.
// @ts-ignore generated at build time
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
