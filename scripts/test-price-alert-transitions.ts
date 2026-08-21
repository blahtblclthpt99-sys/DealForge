import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { parseJson } from "../src/lib/utils";
import { runMaintenanceOnce } from "../src/workers/maintenance";

const categoryId = "ci-alert-transition-category";
const productId = "ci-alert-transition-product";
const userId = "ci-alert-transition-user";
const alertId = "ci-alert-transition-alert";
const message = `Price threshold reached for product ${productId}`;

type StoredAlert = {
  id: string;
  productId: string;
  targetPrice: number;
  triggered?: boolean;
  lastTriggeredAt?: string | null;
};

function trustedSpecifications(checkedAt: string) {
  return JSON.stringify({
    priceSource: "amazon-creators-api",
    priceCheckedAt: checkedAt,
  });
}

async function setTrustedPrice(price: number) {
  const checkedAt = new Date().toISOString();
  await prisma.product.update({
    where: { id: productId },
    data: {
      price,
      originalPrice: price,
      lastUpdated: new Date(checkedAt),
      specifications: trustedSpecifications(checkedAt),
    },
  });
}

async function readAlert() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { priceAlerts: true },
  });
  const alerts = parseJson<StoredAlert[]>(user.priceAlerts, []);
  const alert = alerts.find((candidate) => candidate.id === alertId);
  assert.ok(alert, "price alert should remain stored");
  return alert;
}

async function alertLogCount() {
  return prisma.systemLog.count({
    where: { source: "price-alert", message },
  });
}

async function runAlertMaintenance() {
  return runMaintenanceOnce({
    priceRefreshLimit: 0,
    refreshTrending: false,
    expireFlashDeals: false,
    cleanCache: false,
    processPriceAlerts: true,
  });
}

async function cleanup() {
  await prisma.systemLog.deleteMany({ where: { source: "price-alert", message } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
}

async function main() {
  await cleanup();

  const checkedAt = new Date().toISOString();
  await prisma.category.create({
    data: { id: categoryId, name: "CI Alert Transition", slug: categoryId, icon: "test" },
  });
  await prisma.product.create({
    data: {
      id: productId,
      asin: "B000000099",
      slug: productId,
      title: "CI Alert Transition Product",
      description: "Trusted-price transition fixture",
      brand: "CI",
      categoryId,
      images: '["/images/placeholder-product.svg"]',
      price: 8,
      originalPrice: 8,
      affiliateUrl: "https://www.amazon.com/dp/B000000099?tag=titanfieldos-20",
      retailer: "amazon",
      specifications: trustedSpecifications(checkedAt),
      lastUpdated: new Date(checkedAt),
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      name: "CI Alert User",
      email: "ci-alert-transition@example.test",
      passwordHash: "not-used-by-this-test",
      priceAlerts: JSON.stringify([
        {
          id: alertId,
          productId,
          targetPrice: 9,
          createdAt: checkedAt,
          triggered: false,
          lastTriggeredAt: null,
        },
      ]),
    },
  });

  const first = await runAlertMaintenance();
  assert.equal(first.priceAlertHits, 1, "first below-target observation should trigger once");
  assert.equal((await readAlert()).triggered, true);
  assert.equal(await alertLogCount(), 1);

  const duplicate = await runAlertMaintenance();
  assert.equal(duplicate.priceAlertHits, 0, "same below-target price must not retrigger");
  assert.equal((await readAlert()).triggered, true);
  assert.equal(await alertLogCount(), 1);

  await setTrustedPrice(10);
  const rearm = await runAlertMaintenance();
  assert.equal(rearm.priceAlertHits, 0, "above-target observation should only re-arm");
  assert.equal((await readAlert()).triggered, false);
  assert.equal(await alertLogCount(), 1);

  await setTrustedPrice(8);
  const retrigger = await runAlertMaintenance();
  assert.equal(retrigger.priceAlertHits, 1, "a later fresh drop should trigger again after re-arm");
  assert.equal((await readAlert()).triggered, true);
  assert.equal(await alertLogCount(), 2);

  console.log("price-alert transition regression: PASS");
}

main()
  .finally(cleanup)
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
