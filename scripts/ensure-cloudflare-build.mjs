import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const workerArtifact = fileURLToPath(new URL("../.open-next/worker.js", import.meta.url));

async function artifactExists() {
  try {
    await access(workerArtifact, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

if (await artifactExists()) {
  console.log("[cloudflare-build] OpenNext worker artifact already exists; skipping rebuild.");
  process.exit(0);
}

console.log("[cloudflare-build] OpenNext worker artifact missing; building it before Wrangler deploy/upload.");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "cf:build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("[cloudflare-build] Failed to start the Cloudflare build:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[cloudflare-build] Cloudflare build failed with exit code ${result.status ?? "unknown"}.`);
  process.exit(result.status ?? 1);
}

if (!(await artifactExists())) {
  console.error("[cloudflare-build] cf:build completed but .open-next/worker.js was not produced.");
  process.exit(1);
}

console.log("[cloudflare-build] OpenNext worker artifact is ready for Wrangler.");
