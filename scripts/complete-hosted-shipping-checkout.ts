import { chromium, type Locator, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const checkoutPath = process.env.CHECKOUT_ARTIFACT ?? "checkout.json";
const checkout = JSON.parse(await readFile(checkoutPath, "utf8")) as {
  checkoutUrl?: string;
  orderNumber?: string;
};

if (process.env.SHIPPING_CERT_STRIPE_MODE !== "test") throw new Error("SHIPPING_CERT_REQUIRES_VERIFIED_STRIPE_TEST_MODE");
if (!checkout.checkoutUrl?.startsWith("https://checkout.stripe.com/")) throw new Error("SHIPPING_CERT_CHECKOUT_URL_INVALID");
if (!checkout.orderNumber) throw new Error("SHIPPING_CERT_ORDER_NUMBER_MISSING");

const address = {
  name: "DealForge Shipping Certification",
  line1: "123 N Robinson Ave",
  city: "Oklahoma City",
  state: "OK",
  postalCode: "73102",
  country: "US",
};

async function visible(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible({ timeout: 1000 })) return locator;
      } catch {}
    }
  }
  return null;
}

async function fillRequired(page: Page, selectors: string[], value: string, name: string) {
  const locator = await visible(page, selectors);
  if (!locator) throw new Error(`SHIPPING_CERT_FIELD_NOT_FOUND:${name}`);
  await locator.fill(value);
}

async function fillOptional(page: Page, selectors: string[], value: string) {
  const locator = await visible(page, selectors);
  if (locator) await locator.fill(value);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(checkout.checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);

  await fillOptional(page, ["#email", 'input[name="email"]'], process.env.CERT_EMAIL ?? "phase25-hosted-gate-20260825@example.com");

  await fillRequired(page, ["#shippingName", 'input[name="shippingName"]', 'input[autocomplete="shipping name"]'], address.name, "shipping-name");
  await fillRequired(page, ["#shippingAddressLine1", 'input[name="shippingAddressLine1"]', 'input[autocomplete="shipping address-line1"]'], address.line1, "shipping-line1");
  await fillRequired(page, ["#shippingLocality", 'input[name="shippingLocality"]', 'input[autocomplete="shipping address-level2"]'], address.city, "shipping-city");
  await fillRequired(page, ["#shippingPostalCode", 'input[name="shippingPostalCode"]', 'input[autocomplete="shipping postal-code"]'], address.postalCode, "shipping-postal-code");

  const stateSelect = await visible(page, ["#shippingAdministrativeArea", 'select[name="shippingAdministrativeArea"]', 'select[autocomplete="shipping address-level1"]']);
  if (stateSelect) await stateSelect.selectOption(address.state);
  else await fillRequired(page, ['input[name="shippingAdministrativeArea"]', 'input[autocomplete="shipping address-level1"]'], address.state, "shipping-state");

  await fillRequired(page, ["#cardNumber", 'input[name="cardNumber"]'], "4242424242424242", "card-number");
  await fillRequired(page, ["#cardExpiry", 'input[name="cardExpiry"]'], "1234", "card-expiry");
  await fillRequired(page, ["#cardCvc", 'input[name="cardCvc"]'], "123", "card-cvc");

  await fillOptional(page, ["#billingName", 'input[name="billingName"]'], address.name);
  await fillOptional(page, ["#billingAddressLine1", 'input[name="billingAddressLine1"]'], address.line1);
  await fillOptional(page, ["#billingLocality", 'input[name="billingLocality"]'], address.city);
  await fillOptional(page, ["#billingPostalCode", 'input[name="billingPostalCode"]'], address.postalCode);
  const billingState = await visible(page, ["#billingAdministrativeArea", 'select[name="billingAdministrativeArea"]']);
  if (billingState) await billingState.selectOption(address.state);

  const submit = page.locator('button[type="submit"]').last();
  if (!(await submit.count()) || !(await submit.isVisible())) throw new Error("SHIPPING_CERT_SUBMIT_NOT_FOUND");
  await submit.click();

  await page.waitForURL(url => !url.hostname.endsWith("stripe.com"), { timeout: 90_000 }).catch(() => undefined);
  await page.waitForTimeout(3000);

  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (body.includes("your card was declined") || body.includes("payment failed")) throw new Error("SHIPPING_CERT_PAYMENT_FAILED");

  await writeFile("shipping-checkout-completion.json", JSON.stringify({
    orderNumber: checkout.orderNumber,
    certificationMode: "stripe_test",
    completedAt: new Date().toISOString(),
    finalHost: new URL(page.url()).hostname,
    expectedDestination: address,
  }, null, 2));

  console.log(`Hosted shipping checkout submitted for ${checkout.orderNumber}`);
} catch (error) {
  await page.screenshot({ path: "shipping-checkout-failure.png", fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
