import { readFile, writeFile } from "node:fs/promises";
import { getPrisma } from "../src/lib/db";

async function main() {
  const prisma = getPrisma();
  const checkout = JSON.parse(await readFile(process.env.CHECKOUT_ARTIFACT ?? "checkout.json", "utf8")) as { orderNumber?: string };
  const secret = (process.env.STRIPE_SECRET_KEY || "").trim();

  if (!secret.startsWith("sk_test_")) throw new Error("TAX_CERT_REQUIRES_STRIPE_TEST_MODE");
  if (!checkout.orderNumber) throw new Error("TAX_CERT_ORDER_NUMBER_MISSING");

  const deadline = Date.now() + 90_000;
  let lastState = "not-found";

  try {
    while (Date.now() < deadline) {
      const order = await prisma.order.findUnique({
        where: { orderNumber: checkout.orderNumber },
        include: {
          payments: true,
          destination: true,
          procurementIntents: { select: { executionMode: true } },
        },
      });

      if (!order?.stripeCheckoutSessionId) {
        lastState = order ? `order:${order.status}:session-missing` : "order-not-found";
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.stripeCheckoutSessionId)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!response.ok) throw new Error(`TAX_CERT_STRIPE_SESSION_FETCH_FAILED:${response.status}`);
      const session = await response.json() as {
        id?: string;
        payment_status?: string;
        currency?: string;
        amount_subtotal?: number;
        amount_total?: number;
        automatic_tax?: { enabled?: boolean; status?: string };
        total_details?: { amount_tax?: number; amount_shipping?: number; amount_discount?: number };
      };

      const payment = order.payments.find(item => item.status === "succeeded");
      const event = order.destination
        ? await prisma.paymentEvent.findUnique({ where: { providerEventId: order.destination.sourceEventId } })
        : null;

      const stripeTax = session.total_details?.amount_tax;
      const stripeShipping = session.total_details?.amount_shipping;
      const stripeDiscount = session.total_details?.amount_discount;
      lastState = JSON.stringify({
        orderStatus: order.status,
        paymentStatus: session.payment_status,
        automaticTax: session.automatic_tax,
        stripeTax,
        orderTax: order.taxCents,
        stripeTotal: session.amount_total,
        orderTotal: order.totalCents,
      });

      const complete =
        order.status === "paid" &&
        Boolean(order.paidAt) &&
        session.id === order.stripeCheckoutSessionId &&
        session.payment_status === "paid" &&
        session.currency?.toLowerCase() === order.currency.toLowerCase() &&
        session.automatic_tax?.enabled === true &&
        session.automatic_tax?.status === "complete" &&
        Number.isSafeInteger(session.amount_subtotal) &&
        session.amount_subtotal === order.subtotalCents &&
        Number.isSafeInteger(stripeTax) &&
        (stripeTax ?? 0) > 0 &&
        stripeTax === order.taxCents &&
        stripeShipping === order.shippingCents &&
        stripeDiscount === 0 &&
        session.amount_total === order.totalCents &&
        order.totalCents === order.subtotalCents + order.shippingCents + order.taxCents &&
        payment?.amountCents === order.totalCents &&
        payment.currency.toLowerCase() === order.currency.toLowerCase() &&
        event?.type === "checkout.session.completed" &&
        event.status === "processed" &&
        event.orderId === order.id &&
        order.procurementIntents.every(intent => intent.executionMode === "manual_only");

      if (complete) {
        await writeFile("tax-certification-evidence.json", JSON.stringify({
          orderNumber: order.orderNumber,
          stripeCheckoutSessionId: order.stripeCheckoutSessionId,
          paymentEventId: event?.providerEventId,
          automaticTaxStatus: session.automatic_tax?.status,
          subtotalCents: order.subtotalCents,
          shippingCents: order.shippingCents,
          taxCents: order.taxCents,
          totalCents: order.totalCents,
          paymentAmountCents: payment?.amountCents,
          procurementExecutionModes: [...new Set(order.procurementIntents.map(intent => intent.executionMode))],
          verifiedAt: new Date().toISOString(),
        }, null, 2));
        console.log(`Stripe Automatic Tax certification verified for ${order.orderNumber}`);
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`TAX_CERTIFICATION_NOT_OBSERVED:${lastState}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
