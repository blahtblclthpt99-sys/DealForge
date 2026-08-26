import { writeFile } from "node:fs/promises";
import {
  evaluateLiveStripeTaxReadiness,
  type StripeTaxRegistrationSnapshot,
  type StripeTaxSettingsSnapshot,
} from "../src/lib/stripe-live-tax-readiness";

const secret = (process.env.STRIPE_LIVE_SECRET_KEY || "").trim();
if (!secret.startsWith("sk_live_")) {
  throw new Error("LIVE_TAX_READINESS_REQUIRES_STRIPE_LIVE_KEY");
}

async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) {
    throw new Error(`LIVE_TAX_READINESS_STRIPE_READ_FAILED:${response.status}:${path}`);
  }
  return response.json() as Promise<T>;
}

async function listRegistrations() {
  const registrations: StripeTaxRegistrationSnapshot[] = [];
  let startingAfter: string | undefined;

  for (;;) {
    const query = new URLSearchParams({ limit: "100", status: "all" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const page = await stripeGet<{
      data?: StripeTaxRegistrationSnapshot[];
      has_more?: boolean;
    }>(`/v1/tax/registrations?${query.toString()}`);

    const data = Array.isArray(page.data) ? page.data : [];
    registrations.push(...data);
    if (!page.has_more || data.length === 0) break;
    const last = data[data.length - 1]?.id;
    if (!last) throw new Error("LIVE_TAX_READINESS_PAGINATION_ID_MISSING");
    startingAfter = last;
  }

  return registrations;
}

async function main() {
  const settings = await stripeGet<StripeTaxSettingsSnapshot>("/v1/tax/settings");
  const registrations = await listRegistrations();
  const result = evaluateLiveStripeTaxReadiness(settings, registrations);

  const activeCountries = [...new Set(
    registrations
      .filter(item => item.livemode === true && item.status === "active" && item.country)
      .map(item => item.country as string),
  )].sort();

  await writeFile(
    "live-tax-readiness-evidence.json",
    JSON.stringify({
      ready: result.ready,
      reasons: result.reasons,
      taxSettingsStatus: settings.status ?? null,
      taxSettingsLivemode: settings.livemode ?? null,
      taxBehaviorConfigured: Boolean(settings.defaults?.tax_behavior),
      defaultTaxCodeConfigured: Boolean(settings.defaults?.tax_code),
      headOfficeConfigured: Boolean(
        settings.head_office?.address?.line1 &&
        settings.head_office?.address?.city &&
        settings.head_office?.address?.state &&
        settings.head_office?.address?.postal_code &&
        settings.head_office?.address?.country
      ),
      activeRegistrationCount: result.activeRegistrationCount,
      activeRegistrationCountries: activeCountries,
      verifiedAt: new Date().toISOString(),
    }, null, 2),
  );

  if (!result.ready) {
    throw new Error(`LIVE_TAX_READINESS_BLOCKED:${result.reasons.join(",")}`);
  }

  console.log(`Live Stripe Tax readiness verified with ${result.activeRegistrationCount} active registration(s).`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
