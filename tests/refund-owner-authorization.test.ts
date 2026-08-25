import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSameOriginRefundMutation } from "../src/lib/refund-authorization";

const refundRoutePath = "src/app/api/admin/refunds/route.ts";

test("refund authorization is bound to the configured commerce owner", async () => {
  const source = await readFile("src/lib/refund-authorization.ts", "utf8");
  assert.match(source, /requireProcurementOwner/);
  assert.match(source, /requireRefundOwner = requireProcurementOwner/);
  assert.match(source, /isSameOriginRefundMutation = isSameOriginProcurementMutation/);
});

test("refund route requires owner authorization and same-origin mutation", async () => {
  const source = await readFile(refundRoutePath, "utf8");
  assert.match(source, /requireRefundOwner\(\)/);
  assert.match(source, /isSameOriginRefundMutation\(request\)/);
  assert.match(source, /INVALID_ORIGIN/);
  assert.doesNotMatch(source, /import \{ requireAdmin \} from "@\/lib\/auth"/);
  assert.match(source, /actor: `owner:\$\{owner\.id\}`/);
});

test("refund route bounds JSON input and rejects unknown fields", async () => {
  const source = await readFile(refundRoutePath, "utf8");
  assert.match(source, /MAX_REFUND_REQUEST_BYTES = 16 \* 1024/);
  assert.match(source, /readLimitedJson\(request, MAX_REFUND_REQUEST_BYTES\)/);
  assert.match(source, /REFUND_REQUEST_TOO_LARGE/);
  assert.match(source, /RefundSchema = z\.object\([\s\S]*?\)\.strict\(\)/);
  assert.doesNotMatch(source, /await request\.json\(\)/);
});

test("refund financial responses are private and non-cacheable", async () => {
  const source = await readFile(refundRoutePath, "utf8");
  assert.match(source, /Cache-Control", "private, no-store, max-age=0"/);
  assert.match(source, /Referrer-Policy", "no-referrer"/);
  assert.match(source, /return noStore\(/);
});

test("refund same-origin guard accepts DealForge and rejects cross-site requests", () => {
  const accepted = new Request("https://deal-forge.sale/api/admin/refunds", {
    method: "POST",
    headers: {
      origin: "https://deal-forge.sale",
      "sec-fetch-site": "same-origin",
    },
  });
  const rejected = new Request("https://deal-forge.sale/api/admin/refunds", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(isSameOriginRefundMutation(accepted), true);
  assert.equal(isSameOriginRefundMutation(rejected), false);
});

test("refund still freezes procurement before the Stripe network call", async () => {
  const source = await readFile(refundRoutePath, "utf8");
  const holdIndex = source.indexOf("REFUND_INTERLOCK_HOLD");
  const exceptionIndex = source.indexOf("POST_PURCHASE_REFUND_EXCEPTION_APPROVED");
  const stripeIndex = source.indexOf("createStripeRefund({");
  assert.ok(holdIndex >= 0);
  assert.ok(exceptionIndex >= 0);
  assert.ok(stripeIndex > holdIndex);
  assert.ok(stripeIndex > exceptionIndex);
  assert.match(source, /automaticSupplierPurchasingEnabled: false/);
  assert.match(source, /automaticRecoveryEnabled: false/);
});
