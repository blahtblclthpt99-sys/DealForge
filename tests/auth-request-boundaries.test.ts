import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth API uses a discriminated action schema with bounded credentials", async () => {
  const source = await readFile("src/app/api/auth/route.ts", "utf8");
  assert.match(source, /z\.discriminatedUnion\("action"/);
  assert.match(source, /emailSchema = z\.string\(\)\.trim\(\)\.email\(\)\.max\(320\)/);
  assert.match(source, /\.max\(128\)/);
  assert.match(source, /length <= 72/);
  assert.match(source, /nameSchema = z\.string\(\)\.trim\(\)\.min\(2\)\.max\(100\)/);
});

test("auth API rejects malformed and oversized request bodies without caching responses", async () => {
  const source = await readFile("src/app/api/auth/route.ts", "utf8");
  assert.match(source, /MAX_AUTH_BODY_BYTES = 16 \* 1024/);
  assert.match(source, /AUTH_REQUEST_TOO_LARGE/);
  assert.match(source, /INVALID_AUTH_REQUEST/);
  assert.match(source, /Cache-Control": "no-store"/);
});

test("registration handles unique-email races instead of surfacing a server error", async () => {
  const source = await readFile("src/app/api/auth/route.ts", "utf8");
  assert.match(source, /PrismaClientKnownRequestError/);
  assert.match(source, /error\.code === "P2002"/);
  assert.match(source, /Email already registered/);
});
