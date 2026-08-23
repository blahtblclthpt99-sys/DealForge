import assert from "node:assert/strict";
import test from "node:test";
import { createOrderAccessToken, verifyOrderAccessToken } from "../src/lib/order-access";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "test-order-access-secret-000000000000000000000000000000";

const order = {
  id: "order_123",
  orderNumber: "DF-ABC123-0123ABCD",
  createdAt: new Date("2026-08-23T03:40:00.000Z"),
};

test.after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

test("signed order access token verifies only for the exact order identity", () => {
  const token = createOrderAccessToken(order);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyOrderAccessToken(order, token), true);
  assert.equal(verifyOrderAccessToken({ ...order, id: "order_124" }, token), false);
  assert.equal(verifyOrderAccessToken({ ...order, orderNumber: "DF-ABC124-0123ABCD" }, token), false);
  assert.equal(verifyOrderAccessToken({ ...order, createdAt: new Date("2026-08-23T03:41:00.000Z") }, token), false);
});

test("malformed or modified customer access tokens fail closed", () => {
  const token = createOrderAccessToken(order);
  assert.equal(verifyOrderAccessToken(order, "not-a-token"), false);
  const final = token.at(-1) === "A" ? "B" : "A";
  assert.equal(verifyOrderAccessToken(order, `${token.slice(0, -1)}${final}`), false);
});
