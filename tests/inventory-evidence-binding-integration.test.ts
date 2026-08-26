import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("commercialization requires and binds current inventory evidence in production", async () => {
  const text = await source("src/lib/supplier-commercialization.ts");
  assert.match(text, /inventoryEvidenceBindingRequired\(\)/);
  assert.match(text, /resolveCurrentInventoryEvidence\(selected\.id, selected\.itemCostCents, nowMs\)/);
  assert.match(text, /bindInventoryEvidenceToSpecifications\(specifications, selected\.id, inventory\.evidence\)/);
  assert.match(text, /commerceEnabled: false, availability: "unknown"/);
});

test("inventory observations refresh bound product evidence without promoting commerce", async () => {
  const text = await source("src/lib/inventory-operations.ts");
  assert.match(text, /refreshProductInventoryEvidence/);
  assert.match(text, /refreshBoundInventoryEvidence/);
  assert.match(text, /commercePromoted: false as const/);
});

test("production runtime explicitly requires evidence binding", async () => {
  const text = await source("wrangler.jsonc");
  assert.match(text, /"INVENTORY_EVIDENCE_BINDING_REQUIRED": "true"/);
});
