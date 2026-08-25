import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readLimitedJson } from "../src/lib/request-json";

test("bounded JSON reader parses valid bodies and rejects declared oversize bodies", async () => {
  const valid = await readLimitedJson(
    new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }),
    1024,
  );
  assert.equal(valid.ok, true);

  const oversized = await readLimitedJson(
    new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2048" },
      body: "{}",
    }),
    1024,
  );
  assert.deepEqual(oversized, { ok: false, error: "BODY_TOO_LARGE" });
});

test("bounded JSON reader counts streamed bytes instead of trusting Content-Length alone", async () => {
  const source = await readFile("src/lib/request-json.ts", "utf8");
  assert.match(source, /request\.body\.getReader\(\)/);
  assert.match(source, /bytesRead \+= value\.byteLength/);
  assert.match(source, /bytesRead > maxBytes/);
  assert.match(source, /reader\.cancel\(\)/);
});

test("account updates are strict, bounded, and cannot inject arbitrary settings", async () => {
  const source = await readFile("src/app/api/account/route.ts", "utf8");
  assert.match(source, /AccountPatchSchema/);
  assert.match(source, /emailAlerts: z\.boolean\(\)\.optional\(\)/);
  assert.match(source, /\.strict\(\)/);
  assert.match(source, /readLimitedJson\(req, 8 \* 1024\)/);
  assert.match(source, /select: \{ id: true, name: true, email: true \}/);
  assert.doesNotMatch(source, /await req\.json\(\)/);
});

test("settings client submits only the server-owned settings fields and handles failures", async () => {
  const source = await readFile("src/components/settings-form.tsx", "utf8");
  assert.match(source, /settings: \{ emailAlerts \}/);
  assert.doesNotMatch(source, /settings: \{ \.\.\.settings, emailAlerts \}/);
  assert.match(source, /if \(!res\.ok\)/);
  assert.match(source, /catch \{/);
  assert.match(source, /disabled=\{saving\}/);
});

test("saved searches bound query, filter count, key/value size, and retained rows", async () => {
  const source = await readFile("src/app/api/saved-searches/route.ts", "utf8");
  assert.match(source, /MAX_SAVED_SEARCHES = 30/);
  assert.match(source, /MAX_FILTERS = 12/);
  assert.match(source, /query: z\.string\(\)\.trim\(\)\.max\(256\)/);
  assert.match(source, /\{0,63\}/);
  assert.match(source, /text\.length > 256/);
  assert.match(source, /readLimitedJson/);
  assert.doesNotMatch(source, /await req\.json\(\)/);
});

test("saved-search delete client only refreshes after a successful mutation", async () => {
  const source = await readFile("src/components/delete-search-button.tsx", "utf8");
  assert.match(source, /const res = await fetch/);
  assert.match(source, /if \(!res\.ok\)/);
  assert.match(source, /Could not remove saved search/);
  assert.match(source, /disabled=\{busy\}/);
  assert.ok(source.indexOf("if (!res.ok)") < source.indexOf("router.refresh()"));
});

test("price alerts require a real product and a finite positive bounded target", async () => {
  const source = await readFile("src/app/api/price-alerts/route.ts", "utf8");
  assert.match(source, /MAX_ALERTS = 50/);
  assert.match(source, /targetPrice: z\.number\(\)\.finite\(\)\.positive\(\)\.max\(1_000_000\)/);
  assert.match(source, /prisma\.product\.findUnique/);
  assert.match(source, /Math\.round\(parsed\.data\.targetPrice \* 100\)/);
  assert.match(source, /PRODUCT_NOT_FOUND/);
  assert.doesNotMatch(source, /await req\.json\(\)/);
});

test("price-alert clients validate targets and honor mutation failures", async () => {
  const source = await readFile("src/components/price-alert-form.tsx", "utf8");
  assert.match(source, /Number\.isFinite\(parsedTargetPrice\)/);
  assert.match(source, /parsedTargetPrice > 1_000_000/);
  assert.match(source, /if \(!res\.ok\)/);
  assert.match(source, /Could not create alert/);
  assert.match(source, /Could not remove alert/);
  assert.match(source, /disabled=\{saving\}/);
  assert.match(source, /disabled=\{busy\}/);
});

test("wishlist is capped and cannot store arbitrary nonexistent product IDs", async () => {
  const source = await readFile("src/app/api/wishlist/route.ts", "utf8");
  assert.match(source, /MAX_WISHLIST_ITEMS = 500/);
  assert.match(source, /z\.enum\(\["add", "remove"\]\)/);
  assert.match(source, /prisma\.product\.findUnique/);
  assert.match(source, /WISHLIST_LIMIT_REACHED/);
  assert.match(source, /PRODUCT_NOT_FOUND/);
  assert.doesNotMatch(source, /await req\.json\(\)/);
});
