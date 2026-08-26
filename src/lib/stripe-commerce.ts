import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { parseCheckoutShippingCountries } from "@/lib/checkout-shipping";

const STRIPE_API = "https://api.stripe.com/v1";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

type ProcessEnvLike = Record<string, string | undefined>;
type CloudflareEnvLike = Record<string, unknown>;

export type StripeCheckoutLine = {
  name: string;
  description?: string | null;
  unitAmountCents: number;
  quantity: number;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status?: string;
  payment_intent?: string | null;
  payment_method_types?: string[];
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  amount_subtotal?: number;
  amount_total?: number;
  currency?: string | null;
  automatic_tax?: { enabled?: boolean; status?: string | null } | null;
  total_details?: {
    amount_discount?: number;
    amount_shipping?: number;
    amount_tax?: number;
  } | null;
};

export type StripeBalanceTransaction = {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  source?: string | null;
  status?: string | null;
  type?: string | null;
  reporting_category?: string | null;
};

export type StripeCharge = {
  id: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  status?: string;
  refunded?: boolean;
  payment_intent?: string | null;
  balance_transaction?: string | StripeBalanceTransaction | null;
};

export type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  metadata?: Record<string, string>;
  latest_charge?: string | null | StripeCharge;
};

export type StripeRefund = {
  id: string;
  payment_intent?: string | null;
  charge?: string | null;
  amount: number;
  currency: string;
  status?: string | null;
  metadata?: Record<string, string>;
  reason?: string | null;
  balance_transaction?: string | StripeBalanceTransaction | null;
  failure_balance_transaction?: string | StripeBalanceTransaction | null;
  failure_reason?: string | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
};

/**
 * Resolve a Stripe runtime value with the deployed Cloudflare binding as the
 * authoritative source when one exists. OpenNext exposes Worker bindings to
 * Next.js routes through getCloudflareContext().env; process.env remains the
 * portable fallback for local Node, CI, Netlify previews, and other runtimes.
 *
 * The explicit sources are exported for deterministic regression testing.
 */
export function resolveStripeRuntimeValue(
  name: string,
  processEnv: ProcessEnvLike = process.env,
  cloudflareEnv?: CloudflareEnvLike | null,
) {
  let bindings = cloudflareEnv;
  if (bindings === undefined) {
    try {
      bindings = getCloudflareContext().env as CloudflareEnvLike;
    } catch {
      bindings = null;
    }
  }

  const boundValue = bindings?.[name];
  if (typeof boundValue === "string" && boundValue.trim()) {
    return boundValue.trim();
  }
  return (processEnv[name] || "").trim();
}

function stripeSecretKey() {
  const key = resolveStripeRuntimeValue("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY_MISSING");
  return key;
}

export function stripeAutomaticTaxEnabled() {
  return resolveStripeRuntimeValue("STRIPE_AUTOMATIC_TAX_ENABLED") === "true";
}

export function expectedStripeLivemode(secretKey = resolveStripeRuntimeValue("STRIPE_SECRET_KEY")) {
  if (secretKey.startsWith("sk_live_")) return true;
  if (secretKey.startsWith("sk_test_")) return false;

  // Webhook verification must not falsely report "not configured" merely
  // because the Stripe API key is not present in the same runtime boundary.
  // A single mode-specific webhook secret is sufficient to establish expected
  // event mode. If both are present, fail closed rather than guessing.
  const liveWebhookSecret = resolveStripeRuntimeValue("STRIPE_WEBHOOK_SECRET_LIVE");
  const testWebhookSecret = resolveStripeRuntimeValue("STRIPE_WEBHOOK_SECRET_TEST");
  if (liveWebhookSecret && !testWebhookSecret) return true;
  if (testWebhookSecret && !liveWebhookSecret) return false;
  if (liveWebhookSecret && testWebhookSecret) {
    throw new Error("STRIPE_WEBHOOK_MODE_AMBIGUOUS");
  }

  throw new Error("STRIPE_SECRET_KEY_MODE_UNKNOWN");
}

export function stripeWebhookSecret() {
  const livemode = expectedStripeLivemode();
  const modeSpecific = resolveStripeRuntimeValue(
    livemode ? "STRIPE_WEBHOOK_SECRET_LIVE" : "STRIPE_WEBHOOK_SECRET_TEST",
  );
  const legacy = resolveStripeRuntimeValue("STRIPE_WEBHOOK_SECRET");
  const secret = modeSpecific || legacy;
  if (!secret) {
    throw new Error(
      livemode
        ? "STRIPE_WEBHOOK_SECRET_LIVE_MISSING"
        : "STRIPE_WEBHOOK_SECRET_TEST_MISSING",
    );
  }
  return secret;
}

export function assertStripeEventMode(event: Pick<StripeEvent, "livemode">, expected: boolean) {
  if (typeof event.livemode !== "boolean") throw new Error("STRIPE_EVENT_LIVEMODE_MISSING");
  if (event.livemode !== expected) throw new Error("STRIPE_EVENT_MODE_MISMATCH");
}

export function assertPositiveCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
}

export function assertCardOnlyCheckoutSession(
  session: Pick<StripeCheckoutSession, "payment_method_types">,
) {
  const methods = session.payment_method_types;
  if (!Array.isArray(methods) || methods.length !== 1 || methods[0] !== "card") {
    throw new Error("STRIPE_CARD_ONLY_SESSION_NOT_ENFORCED");
  }
}

export function payloadSha256(payload: string) {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function isExactWebhookReplay(existingPayloadSha256: string, rawBody: string) {
  return constantTimeHexEqual(existingPayloadSha256, payloadSha256(rawBody));
}

function constantTimeHexEqual(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options?: { nowSeconds?: number; toleranceSeconds?: number },
) {
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampRaw = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestampRaw || signatures.length === 0) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;

  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options?.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return signatures.some((candidate) => constantTimeHexEqual(candidate, expected));
}

async function stripeRequest<T>(
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: URLSearchParams;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${stripeSecretKey()}`,
  };
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const response = await fetch(`${STRIPE_API}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    cache: "no-store",
  });
  const data = (await response.json()) as T & {
    error?: { message?: string; type?: string; code?: string };
  };
  if (!response.ok) {
    const message = data.error?.message || `Stripe request failed (${response.status})`;
    throw new Error(`STRIPE_API_ERROR:${message}`);
  }
  return data;
}

export async function createStripeCheckoutSession(input: {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  currency: string;
  lines: StripeCheckoutLine[];
  successUrl: string;
  cancelUrl: string;
  cardOnly?: boolean;
}) {
  const body = new URLSearchParams();
  body.set("mode", "payment");
  // DealForge is the merchant for physical-goods transactions. Stripe Managed
  // Payments is a separate merchant-of-record product intended for eligible
  // digital goods and must not be implicitly enabled for DealForge orders.
  body.set("managed_payments[enabled]", "false");
  // Tax remains runtime-gated. Setting the parameter explicitly makes a
  // deployed certification environment deterministic while preserving the
  // production false default until tax certification is complete.
  body.set("automatic_tax[enabled]", stripeAutomaticTaxEnabled() ? "true" : "false");
  // Certification sessions intentionally render card directly so the end-to-end
  // payment gate can exercise the canonical card path deterministically. Normal
  // production sessions keep Stripe's configured payment-method set.
  if (input.cardOnly) {
    body.append("payment_method_types[]", "card");
  }
  body.set("client_reference_id", input.orderId);
  body.set("customer_email", input.customerEmail);
  body.set("success_url", input.successUrl);
  body.set("cancel_url", input.cancelUrl);
  body.set("metadata[order_id]", input.orderId);
  body.set("metadata[order_number]", input.orderNumber);
  body.set("payment_intent_data[metadata][order_id]", input.orderId);
  body.set("payment_intent_data[metadata][order_number]", input.orderNumber);

  // The Checkout Session is the shipping-address authority. Browser checkout
  // payloads do not contain an address, and an empty country scope fails closed.
  const allowedShippingCountries = parseCheckoutShippingCountries(
    resolveStripeRuntimeValue("CHECKOUT_ALLOWED_SHIPPING_COUNTRIES"),
  );
  if (allowedShippingCountries.length === 0) {
    throw new Error("CHECKOUT_SHIPPING_COUNTRIES_NOT_CONFIGURED");
  }
  for (const country of allowedShippingCountries) {
    body.append("shipping_address_collection[allowed_countries][]", country);
  }

  input.lines.forEach((line, index) => {
    assertPositiveCents(line.unitAmountCents, "unit_amount");
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 25) {
      throw new Error("QUANTITY_INVALID");
    }
    body.set(`line_items[${index}][price_data][currency]`, input.currency.toLowerCase());
    body.set(`line_items[${index}][price_data][unit_amount]`, String(line.unitAmountCents));
    body.set(`line_items[${index}][price_data][product_data][name]`, line.name.slice(0, 250));
    if (line.description) {
      body.set(
        `line_items[${index}][price_data][product_data][description]`,
        line.description.slice(0, 500),
      );
    }
    body.set(`line_items[${index}][quantity]`, String(line.quantity));
  });

  const session = await stripeRequest<StripeCheckoutSession>("/checkout/sessions", {
    method: "POST",
    body,
    idempotencyKey: `dealforge-checkout:${input.orderId}`,
  });
  if (input.cardOnly) assertCardOnlyCheckoutSession(session);
  return session;
}

export async function retrieveStripePaymentIntent(paymentIntentId: string) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) throw new Error("PAYMENT_INTENT_ID_INVALID");
  return stripeRequest<StripePaymentIntent>(
    `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand%5B%5D=latest_charge.balance_transaction`,
  );
}

export async function retrieveStripeBalanceTransaction(balanceTransactionId: string) {
  if (!/^txn_[A-Za-z0-9_]+$/.test(balanceTransactionId)) {
    throw new Error("BALANCE_TRANSACTION_ID_INVALID");
  }
  return stripeRequest<StripeBalanceTransaction>(
    `/balance_transactions/${encodeURIComponent(balanceTransactionId)}`,
  );
}

export async function retrieveStripeRefund(refundId: string) {
  if (!/^re_[A-Za-z0-9_]+$/.test(refundId)) throw new Error("REFUND_ID_INVALID");
  return stripeRequest<StripeRefund>(
    `/refunds/${encodeURIComponent(refundId)}?expand%5B%5D=balance_transaction&expand%5B%5D=failure_balance_transaction`,
  );
}

export async function createStripeRefund(input: {
  orderId: string;
  orderNumber: string;
  paymentIntentId: string;
  amountCents: number;
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  idempotencyKey: string;
}) {
  assertPositiveCents(input.amountCents, "refund_amount");
  const body = new URLSearchParams();
  body.set("payment_intent", input.paymentIntentId);
  body.set("amount", String(input.amountCents));
  body.set("metadata[order_id]", input.orderId);
  body.set("metadata[order_number]", input.orderNumber);
  if (input.reason) body.set("reason", input.reason);

  return stripeRequest<StripeRefund>("/refunds", {
    method: "POST",
    body,
    idempotencyKey: input.idempotencyKey,
  });
}
