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

test("production schema checker is read-only and verifies every replay-protection index", async () => {
  const checker = await readFile("scripts/check-inventory-adapter-schema.ts", "utf8");

  assert.match(checker, /InventoryAdapterNonce/);
  assert.match(checker, /InventoryAdapterNonce_nonceHash_key/);
  assert.match(checker, /InventoryAdapterNonce_expires_idx/);
  assert.match(checker, /InventoryAdapterNonce_adapter_source_idx/);
  assert.match(checker, /to_regclass/);
  assert.doesNotMatch(checker, /\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/);
});

test("Cloudflare certification workflow is ephemeral, schema-gated, and refuses to overwrite real adapter credentials", async () => {
  const workflow = await readFile(".github/workflows/inventory-adapter-certification.yml", "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /src\/lib\/inventory-adapter-auth\.ts/);
  assert.match(workflow, /inventory_adapter_nonce_v1/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /check-inventory-adapter-schema\.ts/);
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

test("production Cloudflare deploy fails closed when adapter replay schema is missing", async () => {
  const workflow = await readFile(".github/workflows/cloudflare-production-deploy.yml", "utf8");
  const schemaCheck = workflow.indexOf("Verify critical production schema contracts");
  const build = workflow.indexOf("Build Cloudflare Worker");
  const deploy = workflow.indexOf("Deploy exact main revision");

  assert.ok(schemaCheck >= 0);
  assert.ok(build >= 0);
  assert.ok(deploy >= 0);
  assert.ok(schemaCheck < build, "production schema must be verified before build/publish");
  assert.ok(schemaCheck < deploy, "production schema must be verified before publish");
  assert.match(workflow, /check-inventory-adapter-schema\.ts/);
});
