/**
 * Long-running maintenance runner for traditional Node hosting.
 *
 * Cloudflare production uses the same maintenance implementation from
 * `maintenance.ts` through a Cron Trigger. This process wrapper remains useful
 * for local/manual runs and for the preserved Koyeb fallback.
 *
 * Run: npm run worker
 * Once: npm run worker -- --once
 */

import { runMaintenanceOnce } from "./maintenance";

const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const once = process.argv.includes("--once");
let running = false;

async function guardedRun() {
  if (running) {
    console.warn("[worker] previous cycle still running; skipping overlapping cycle");
    return;
  }

  running = true;
  try {
    console.log(`[worker] starting ${new Date().toISOString()}`);
    const result = await runMaintenanceOnce();
    console.log(
      `[worker] done — ${result.priceUpdates} prices, ${result.priceAlertHits} price alert hits, ${result.trendingProducts} trending rows, ${result.expiredFlashDeals} flash deals expired, ${result.purgedCacheEntries} cache entries purged`,
    );
  } finally {
    running = false;
  }
}

guardedRun()
  .then(() => {
    if (once) process.exit(0);
    setInterval(() => {
      guardedRun().catch(console.error);
    }, WORKER_INTERVAL_MS);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
