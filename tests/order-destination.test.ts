import assert from "node:assert/strict";
import test, { after } from "node:test";
import { prisma } from "../src/lib/db";
import { CERTIFICATION_CATALOG_PRODUCT_IDS } from "../src/lib/certification-catalog";
import {
  assertAuthoritativeDestinationReady,
  persistAuthoritativeCheckoutDestination,
  sameOrderDestination,
} from "../src/lib/order-destination";

const PREFIX = "test-destination-";
const beforeCountries = process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES;
process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES = "US";

async function createOrder(suffix: string, productId: string) {
  return prisma.order.create({
    data: {
      orderNumber: `DF-DEST-${suffix}`,
      checkoutKey: `${PREFIX}${suffix}`,
      email: "destination@example.test",
      currency: "usd",
      status: "pending_payment",
      subtotalCents: 1999,
      totalCents: 1999,
      items: {
        create: {
          productId,
          productSlug: `destination-${suffix}`,
          title: "Destination test item",
          quantity: 1,
          unitPriceCents: 1999,
          lineTotalCents: 1999,
          landedCostCents: 1200,
          supplierSnapshot: productId.startsWith("cert_") ? "{}" : '{"supplier":"test"}',
        },
      },
    },
  });
}

function checkoutObject(sessionId: string, line1 = "123 Main St") {
  return {
    id: sessionId,
    collected_information: {
      shipping_details: {
        name: "Ada Buyer",
        address: {
          line1,
          line2: "Unit 4",
          city: "Oklahoma City",
          state: "OK",
          postal_code: "73102",
          country: "US",
        },
      },
    },
  } as Record<string, unknown>;
}

after(async () => {
  await prisma.order.deleteMany({ where: { checkoutKey: { startsWith: PREFIX } } });
  if (beforeCountries === undefined) delete process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES;
  else process.env.CHECKOUT_ALLOWED_SHIPPING_COUNTRIES = beforeCountries;
  await prisma.$disconnect();
});

test("physical payment is blocked until the authoritative destination exists", async () => {
  const order = await createOrder("missing", "physical-destination-product");
  await assert.rejects(
    prisma.$transaction((tx) => assertAuthoritativeDestinationReady(tx, order.id)),
    /WEBHOOK_SHIPPING_DESTINATION_MISSING/,
  );
});

test("signed Checkout destination is persisted once and exact replays remain immutable", async () => {
  const order = await createOrder("persist", "physical-destination-product-2");
  const object = checkoutObject("cs_destination_persist");

  const first = await prisma.$transaction((tx) =>
    persistAuthoritativeCheckoutDestination(tx, {
      orderId: order.id,
      eventId: "evt_destination_first",
      object,
    }),
  );
  assert.deepEqual(first, { required: true, persisted: true });

  const stored = await prisma.orderDestination.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.equal(stored.source, "stripe_checkout");
  assert.equal(stored.providerSessionId, "cs_destination_persist");
  assert.equal(stored.sourceEventId, "evt_destination_first");
  assert.equal(stored.recipientName, "Ada Buyer");
  assert.equal(stored.country, "US");

  const replay = await prisma.$transaction((tx) =>
    persistAuthoritativeCheckoutDestination(tx, {
      orderId: order.id,
      eventId: "evt_destination_replay",
      object,
    }),
  );
  assert.deepEqual(replay, { required: true, persisted: false });
  assert.equal(
    (await prisma.orderDestination.findUniqueOrThrow({ where: { orderId: order.id } })).sourceEventId,
    "evt_destination_first",
  );

  await prisma.$transaction((tx) => assertAuthoritativeDestinationReady(tx, order.id));
});

test("destination drift after first persistence fails closed", async () => {
  const order = await createOrder("drift", "physical-destination-product-3");
  await prisma.$transaction((tx) =>
    persistAuthoritativeCheckoutDestination(tx, {
      orderId: order.id,
      eventId: "evt_destination_drift_first",
      object: checkoutObject("cs_destination_drift"),
    }),
  );

  await assert.rejects(
    prisma.$transaction((tx) =>
      persistAuthoritativeCheckoutDestination(tx, {
        orderId: order.id,
        eventId: "evt_destination_drift_second",
        object: checkoutObject("cs_destination_drift", "999 Changed Ave"),
      }),
    ),
    /WEBHOOK_SHIPPING_DESTINATION_MISMATCH/,
  );
  assert.equal(
    (await prisma.orderDestination.findUniqueOrThrow({ where: { orderId: order.id } })).line1,
    "123 Main St",
  );
});

test("destination comparator binds both address and Checkout Session identity", () => {
  const candidate = {
    providerSessionId: "cs_same",
    name: "Ada Buyer",
    line1: "123 Main St",
    line2: null,
    city: "Oklahoma City",
    state: "OK",
    postalCode: "73102",
    country: "US",
  };
  assert.equal(
    sameOrderDestination(
      {
        providerSessionId: "cs_same",
        recipientName: "Ada Buyer",
        line1: "123 Main St",
        line2: null,
        city: "Oklahoma City",
        state: "OK",
        postalCode: "73102",
        country: "US",
      },
      candidate,
    ),
    true,
  );
  assert.equal(
    sameOrderDestination(
      {
        providerSessionId: "cs_other",
        recipientName: "Ada Buyer",
        line1: "123 Main St",
        line2: null,
        city: "Oklahoma City",
        state: "OK",
        postalCode: "73102",
        country: "US",
      },
      candidate,
    ),
    false,
  );
});

test("certification-only orders remain exempt from the physical shipping table", async () => {
  const order = await createOrder("cert", CERTIFICATION_CATALOG_PRODUCT_IDS[0]);
  const result = await prisma.$transaction((tx) =>
    persistAuthoritativeCheckoutDestination(tx, {
      orderId: order.id,
      eventId: "evt_destination_cert",
      object: { id: "cs_destination_cert" },
    }),
  );
  assert.deepEqual(result, { required: false, persisted: false });
  await prisma.$transaction((tx) => assertAuthoritativeDestinationReady(tx, order.id));
  assert.equal(await prisma.orderDestination.count({ where: { orderId: order.id } }), 0);
});
