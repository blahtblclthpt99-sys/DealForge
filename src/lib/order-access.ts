import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_PRODUCTION_SECRET_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function orderAccessSecret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < MIN_PRODUCTION_SECRET_LENGTH)) {
    throw new Error("AUTH_SECRET is unavailable for customer order access");
  }
  return configured || "dev-insecure-secret";
}

function payload(input: { id: string; orderNumber: string; createdAt: Date }) {
  return `dealforge-order-access:v1:${input.id}:${input.orderNumber}:${input.createdAt.toISOString()}`;
}

export function createOrderAccessToken(input: { id: string; orderNumber: string; createdAt: Date }) {
  return createHmac("sha256", orderAccessSecret())
    .update(payload(input))
    .digest("base64url");
}

export function verifyOrderAccessToken(
  input: { id: string; orderNumber: string; createdAt: Date },
  candidate: string,
) {
  if (!TOKEN_PATTERN.test(candidate)) return false;
  const expected = createOrderAccessToken(input);
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(candidate, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
