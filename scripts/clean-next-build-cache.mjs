import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const turbopackCache = fileURLToPath(new URL("../.next/cache/turbopack", import.meta.url));

try {
  await rm(turbopackCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  console.log("[build-cache] Removed stale Next.js Turbopack cache before production build.");
} catch (error) {
  console.error("[build-cache] Unable to clear stale Turbopack cache:", error);
  process.exit(1);
}
