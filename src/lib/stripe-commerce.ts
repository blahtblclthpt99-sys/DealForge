import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const STRIPE_API = "https://api.stripe.com/v1";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

type StripeRuntimeSecretName = "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET";

export type StripeCheckoutLine = {
  name: string;
  description?: string | null;
  unitAmountCents: number;
  quantity: number;
};

type StripePrice = {
  id: string;
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status?: string;
  payment_intent?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
};

export type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  metadata?: Record<string, string>;
  latest_charge?: string | null | { id: string; amount?: number; amount_refunded?: number; refunded?: boolean };
};

export type StripeRefund = {
  id: string;
  payment_intent?: string | null;
  amount: number;
  currency: string;
  status?: string | null;
  metadata?: Record<string, string>;
};

export type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
};

function readStripeRuntimeSecret(name: StripeRuntimeSecretName) {
  const processValue = process.env[name];
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();

  try {
    const cloudflareEnv = getCloudflareContext().env as Record<string, unknown>;
    const bindingValue = cloudflareEnv[name];
    if (typeof bindingValue === "string" && bindingValue.trim()) return bindingValue.trim();
  } catch {
    // Local Node/test execution does not have a Cloudflare request context.
  }

  throw new Error(`${name}_MISSING`);
}

function stripeSecretKey() {
  const key = readStripeRuntimeSecret("STRIPE_SECRET_KEY");
  if (!/^(sk|rk)_(live|test)_/i.test(key)) throw new Error("STRIPE_SECRET_KEY_WRONG_TYPE");
  return key;
}

export function stripeWebhookSecret() {
  return readStripeRuntimeSecret("STRIPE_WEBHOOK_SECRET");
}

export function assertPositiveCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field.toUpperCase()}_INVALID`);
}

export function payloadSha256(payload: string) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function constantTimeHexEqual(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeStripeErrorToken(value: unknown) {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  return /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(trimmed) ? trimmed : "unknown";
}

export function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string, options?: { nowSeconds?: number; toleranceSeconds?: number }) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampRaw = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestampRaw || signatures.length === 0) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp)) return false;
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options?.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return signatures.some((candidate) => constantTimeHexEqual(candidate, expected));
}

async function stripeRequest<T>(path: string, init: { method?: "GET" | "POST"; body?: URLSearchParams; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${stripeSecretKey()}` };
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const response = await fetch(`${STRIPE_API}${path}`, { method: init.method ?? "GET", headers, body: init.body, cache: "no-store" });
  const data = (await response.json()) as T & { error?: { message?: string; type?: string; code?: string; param?: string } };
  if (!response.ok) {
    const provider = data.error;
    const type = safeStripeErrorToken(provider?.type);
    const code = safeStripeErrorToken(provider?.code);
    const param = safeStripeErrorToken(provider?.param);
    const message = typeof provider?.message === "string" ? provider.message : String(response.status);
    throw new Error(`STRIPE_API_ERROR:${type}:${code}:${param}:${message}`);
  }
  return data;
}

async function createStripeOrderPrice(input: {
  orderId: string;
  orderNumber: string;
  currency: string;
  line: StripeCheckoutLine;
  index: number;
}) {
  assertPositiveCents(input.line.unitAmountCents, "unit_amount");
  if (!Number.isSafeInteger(input.line.quantity) || input.line.quantity < 1 || input.line.quantity > 25) throw new Error("QUANTITY_INVALID");

  const body = new URLSearchParams();
  body.set("currency", input.currency.toLowerCase());
  body.set("unit_amount", String(input.line.unitAmountCents));
  body.set("product_data[name]", input.line.name.slice(0, 250));
  body.set("product_data[metadata][dealforge_order_id]", input.orderId);
  body.set("product_data[metadata][dealforge_order_number]", input.orderNumber);
  body.set("metadata[dealforge_order_id]", input.orderId);
  body.set("metadata[dealforge_order_number]", input.orderNumber);
  body.set("metadata[dealforge_line_index]", String(input.index));

  const price = await stripeRequest<StripePrice>("/prices", {
    method: "POST",
    body,
    idempotencyKey: `dealforge-price:${input.orderId}:${input.index}:${input.currency.toLowerCase()}:${input.line.unitAmountCents}`,
  });
  if (!/^price_[A-Za-z0-9_]+$/.test(price.id || "")) throw new Error("STRIPE_PRICE_INVALID");
  return price;
}

export async function createStripeCheckoutSession(input: { orderId: string; orderNumber: string; customerEmail: string; currency: string; lines: StripeCheckoutLine[]; successUrl: string; cancelUrl: string }) {
  const stripePrices: StripePrice[] = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    stripePrices.push(await createStripeOrderPrice({
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      currency: input.currency,
      line: input.lines[index],
      index,
    }));
  }

  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("client_reference_id", input.orderId);
  body.set("customer_email", input.customerEmail);
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("metadata[order_id]", input.orderId);
  body.set("metadata[order_number]", input.orderNumber);
  body.set("payment_intent_data[metadata][order_id]", input.orderId);
  body.set("payment_intent_data[metadata][order_number]", input.orderNumber);
  stripePrices.forEach((price, index) => {
    body.set(`line_items[${index}][price]`, price.id);
    body.set(`line_items[${index}][quantity]`, String(input.lines[index].quantity));
  });

  return stripeRequest<StripeCheckoutSession>("/checkout/sessions", { method: "POST", body, idempotencyKey: `dealforge-checkout:${input.orderId}` });
}

export async function retrieveStripePaymentIntent(paymentIntentId: string) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) throw new Error("PAYMENT_INTENT_ID_INVALID");
  return stripeRequest<StripePaymentIntent>(`/payment_intents/${encodeURIComponent(paymentIntentId)}?expand%5B%5D=latest_charge`);
}

export async function createStripeRefund(input: { orderId: string; orderNumber: string; paymentIntentId: string; amountCents: number; reason?: "duplicate" | "fraudulent" | "requested_by_customer"; idempotencyKey: string }) {
  assertPositiveCents(input.amountCents, "refund_amount");
  const body = new URLSearchParams();
  body.set("payment_intent", input.paymentIntentId);
  body.set("amount", String(input.amountCents));
  body.set("metadata[order_id]", input.orderId);
  body.set("metadata[order_number]", input.orderNumber);
  if (input.reason) body.set("reason", input.reason);
  return stripeRequest<StripeRefund>("/refunds", { method: "POST", body, idempotencyKey: input.idempotencyKey });
}
