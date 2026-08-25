import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("certification endpoint reuses production adapter authentication before parsing", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter-certification/route.ts", "utf8");
  const rawIndex = route.indexOf("const rawBody = await readRawBody(req)");
  const authIndex = route.indexOf("await authenticateInventoryAdapterRequest({ headers: req.headers, body: rawBody })");
  const parseIndex = route.indexOf("JSON.parse(rawBody)");

  assert.ok(rawIndex >= 0);
  assert.ok(authIndex >= 0);
  assert.ok(parseIndex >= 0);
  assert.ok(rawIndex < authIndex, "raw request bytes must be captured before authentication");
  assert.ok(authIndex < parseIndex, "certification must authenticate before parsing the action");
  assert.match(route, /MAX_BODY_BYTES = 1024/);
  assert.match(route, /action !== "certify"/);
  assert.match(route, /protocol: "inventory-adapter-hmac-v1"/);
  assert.match(route, /Cache-Control": "no-store"/);
});

test("certification endpoint has no inventory, commerce, payment, or procurement authority", async () => {
  const route = await readFile("src/app/api/internal/inventory-adapter-certification/route.ts", "utf8");

  assert.doesNotMatch(route, /inventory-operations|inventory-recheck|claimDue|completeInventory|failInventory/i);
  assert.doesNotMatch(route, /commerceEnabled\s*:/i);
  assert.doesNotMatch(route, /stripe|checkout|paymentIntent|refund/i);
  assert.doesNotMatch(route, /procurement|purchase|supplierOffer\.(create|update|delete)/i);
  assert.doesNotMatch(route, /prisma\.(?!\$)/i);
});

test("certification client signs exact raw body and requires replay rejection", async () => {
  const client = await readFile("scripts/certify-inventory-adapter.mjs", "utf8");

  assert.match(client, /createHash\("sha256"\)\.update\(body\)/);
  assert.match(client, /createHmac\("sha256", secret\)/);
  assert.match(client, /\[adapterId, sourceKey, timestamp, nonce, bodySha256\]\.join\("\\n"\)/);
  assert.match(client, /body = JSON\.stringify\(\{ action: "certify" \}\)/);
  assert.match(client, /replay\.status !== 409/);
  assert.match(client, /ADAPTER_REPLAY_DETECTED/);
});

test("Cloudflare certification workflow is ephemeral and refuses to overwrite real adapter credentials", async () => {
  const workflow = await readFile(".github/workflows/inventory-adapter-certification.yml", "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ADAPTER_AUTH_NOT_CONFIGURED/);
  assert.match(workflow, /wrangler secret list --name dealforge --format json/);
  assert.match(workflow, /refusing certification overwrite/i);
  assert.match(workflow, /randomBytes\(48\)/);
  assert.match(workflow, /wrangler secret put INVENTORY_ADAPTER_SECRETS_JSON --name dealforge/);
  assert.match(workflow, /scripts\/certify-inventory-adapter\.mjs/);
  assert.match(workflow, /method POST|\-X POST/);
  assert.match(workflow, /\-X DELETE/);
  assert.match(workflow, /workers\/scripts\/dealforge\/secrets\/INVENTORY_ADAPTER_SECRETS_JSON/);
  assert.match(workflow, /Prove adapters returned to disabled state/);
  assert.doesNotMatch(workflow, /INVENTORY_ADAPTER_SECRETS_JSON:\s*\$\{\{\s*secrets\./);
});
