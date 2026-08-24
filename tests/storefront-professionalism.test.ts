import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shopper-facing header contains no hardcoded personal targeting", async () => {
  const header = await readFile("src/components/header.tsx", "utf8");

  assert.doesNotMatch(header, /lisasalas85@icloud\.com/i);
  assert.doesNotMatch(header, /oooooo youre so sexy mamma/i);
  assert.doesNotMatch(header, /showLisaGreeting/);
});

test("header keeps standard authenticated and admin navigation after cleanup", async () => {
  const header = await readFile("src/components/header.tsx", "utf8");

  assert.match(header, /user\.role === "admin"/);
  assert.match(header, /href="\/dashboard"/);
  assert.match(header, /href="\/admin"/);
  assert.match(header, /aria-label="DealForge home"/);
});
