import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

for (const path of [
  "scripts/complete-hosted-shipping-checkout.ts",
  "scripts/verify-shipping-certification.ts",
]) {
  test(`${path} is executable through tsx CommonJS transform`, async () => {
    const source = await readFile(path, "utf8");
    const result = await transform(source, {
      loader: "ts",
      format: "cjs",
      target: "node24",
      sourcemap: false,
    });
    assert.ok(result.code.includes("main"));
  });
}

test("shipping verifier uses DealForge's adapter-aware database factory", async () => {
  const source = await readFile("scripts/verify-shipping-certification.ts", "utf8");
  assert.match(source, /import \{ getPrisma \} from "\.\.\/src\/lib\/db"/);
  assert.match(source, /const prisma = getPrisma\(\)/);
  assert.doesNotMatch(source, /new PrismaClient\(/);
});
