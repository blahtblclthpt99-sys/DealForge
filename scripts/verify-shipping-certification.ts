import { PrismaClient } from "@prisma/client";
import { readFile, writeFile } from "node:fs/promises";

const prisma = new PrismaClient();
const checkout = JSON.parse(await readFile(process.env.CHECKOUT_ARTIFACT ?? "checkout.json", "utf8")) as {
  orderNumber?: string;
  stripeMode?: string;
};
const completion = JSON.parse(await readFile(process.env.COMPLETION_ARTIFACT ?? "shipping-checkout-completion.json", "utf8")) as {
  expectedDestination?: { name?: string; line1?: string; city?: string; state?: string; postalCode?: string; country?: string };
};

if (checkout.stripeMode !== "test") throw new Error("SHIPPING_CERT_REQUIRES_TEST_MODE");
if (!checkout.orderNumber) throw new Error("SHIPPING_CERT_ORDER_NUMBER_MISSING");
const expected = completion.expectedDestination;
if (!expected) throw new Error("SHIPPING_CERT_EXPECTED_DESTINATION_MISSING");

const deadline = Date.now() + 90_000;
let lastState = "not-found";

try {
  while (Date.now() < deadline) {
    const order = await prisma.order.findUnique({
      where: { orderNumber: checkout.orderNumber },
      include: {
        items: { select: { id: true } },
        destination: true,
        procurementIntents: { select: { id: true, orderItemId: true, status: true, executionMode: true, createdAt: true } },
      },
    });

    if (!order) {
      lastState = "order-not-found";
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }

    const event = order.destination
      ? await prisma.paymentEvent.findUnique({ where: { providerEventId: order.destination.sourceEventId } })
      : null;

    lastState = JSON.stringify({
      status: order.status,
      paid: Boolean(order.paidAt),
      destination: Boolean(order.destination),
      event: event?.type ?? null,
      intents: order.procurementIntents.length,
      items: order.items.length,
    });

    const destination = order.destination;
    const complete =
      order.status === "paid" &&
      Boolean(order.paidAt) &&
      Boolean(order.stripeCheckoutSessionId) &&
      Boolean(order.stripePaymentIntentId) &&
      destination?.source === "stripe_checkout" &&
      destination.stripeCheckoutSessionId === order.stripeCheckoutSessionId &&
      event?.type === "checkout.session.completed" &&
      event.status === "processed" &&
      event.orderId === order.id &&
      destination.name === expected.name &&
      destination.line1 === expected.line1 &&
      destination.city === expected.city &&
      destination.state === expected.state &&
      destination.postalCode === expected.postalCode &&
      destination.country === expected.country &&
      order.procurementIntents.length === order.items.length &&
      order.items.every(item => order.procurementIntents.some(intent => intent.orderItemId === item.id)) &&
      order.procurementIntents.every(intent =>
        intent.executionMode === "manual_only" &&
        intent.createdAt.getTime() >= destination.createdAt.getTime(),
      );

    if (complete) {
      const evidence = {
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        stripeCheckoutSessionId: order.stripeCheckoutSessionId,
        paymentEventId: event.providerEventId,
        paymentEventType: event.type,
        destinationSource: destination.source,
        destinationCountry: destination.country,
        procurementIntentCount: order.procurementIntents.length,
        orderItemCount: order.items.length,
        procurementExecutionModes: [...new Set(order.procurementIntents.map(intent => intent.executionMode))],
        verifiedAt: new Date().toISOString(),
      };
      await writeFile("shipping-certification-evidence.json", JSON.stringify(evidence, null, 2));
      console.log(`Shipping destination certification verified for ${order.orderNumber}`);
      process.exitCode = 0;
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (!process.exitCode && !(await readFile("shipping-certification-evidence.json", "utf8").catch(() => null))) {
    throw new Error(`SHIPPING_CERTIFICATION_NOT_OBSERVED:${lastState}`);
  }
} finally {
  await prisma.$disconnect();
}
