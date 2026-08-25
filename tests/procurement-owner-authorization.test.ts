import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSameOriginProcurementMutation } from "../src/lib/procurement-authorization";

const mutationRoutes = [
  "src/app/api/admin/procurement/[id]/route.ts",
  "src/app/api/admin/procurement/[id]/shipment/route.ts",
  "src/app/api/admin/procurement/[id]/recovery/route.ts",
];

test("procurement owner helper fails closed around the configured owner identity", async () => {
  const helper = await readFile("src/lib/procurement-authorization.ts", "utf8");
  assert.match(helper, /requireAdmin\(\)/);
  assert.match(helper, /PRODUCT_ENGINE_OWNER_EMAIL/);
  assert.match(helper, /user\.role !== "admin"/);
  assert.match(helper, /user\.email\.toLowerCase\(\) !== ownerEmail/);
  assert.match(helper, /throw new Error\("FORBIDDEN"\)/);
});

test("every procurement mutation route requires owner authorization and same-origin requests", async () => {
  for (const path of mutationRoutes) {
    const source = await readFile(path, "utf8");
    assert.match(source, /requireProcurementOwner/);
    assert.match(source, /isSameOriginProcurementMutation\(request\)/);
    assert.match(source, /INVALID_ORIGIN/);
    assert.doesNotMatch(source, /import \{ requireAdmin \} from "@\/lib\/auth"/);
    assert.match(source, /actor: `owner:\$\{auth\.admin\.id\}`/);
  }
});

test("procurement economics console is owner-only", async () => {
  const source = await readFile("src/app/api/admin/procurement/route.ts", "utf8");
  assert.match(source, /requireProcurementOwner/);
  assert.doesNotMatch(source, /import \{ requireAdmin \} from "@\/lib\/auth"/);
});

test("same-origin procurement guard accepts the application origin and rejects cross-site requests", () => {
  const sameOrigin = new Request("https://deal-forge.sale/api/admin/procurement/test", {
    method: "POST",
    headers: {
      origin: "https://deal-forge.sale",
      "sec-fetch-site": "same-origin",
    },
  });
  const crossOrigin = new Request("https://deal-forge.sale/api/admin/procurement/test", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(isSameOriginProcurementMutation(sameOrigin), true);
  assert.equal(isSameOriginProcurementMutation(crossOrigin), false);
});

test("automatic supplier purchasing remains explicitly disabled", async () => {
  const intent = await readFile("src/lib/procurement-intents.ts", "utf8");
  assert.match(intent, /PROCUREMENT_EXECUTION_MODE = "manual_only"/);
  for (const path of mutationRoutes) {
    const source = await readFile(path, "utf8");
    assert.match(source, /automaticSupplierPurchasingEnabled: false|automaticRecoveryEnabled: false/);
  }
});
