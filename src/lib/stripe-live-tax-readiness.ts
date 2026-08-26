export type StripeTaxSettingsSnapshot = {
  status?: string;
  livemode?: boolean;
  defaults?: {
    tax_behavior?: string | null;
    tax_code?: string | null;
  };
  head_office?: {
    address?: {
      line1?: string | null;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      country?: string | null;
    } | null;
  } | null;
};

export type StripeTaxRegistrationSnapshot = {
  id?: string;
  livemode?: boolean;
  status?: string;
  country?: string;
};

export type LiveTaxReadinessResult = {
  ready: boolean;
  reasons: string[];
  activeRegistrationCount: number;
};

export function evaluateLiveStripeTaxReadiness(
  settings: StripeTaxSettingsSnapshot,
  registrations: StripeTaxRegistrationSnapshot[],
): LiveTaxReadinessResult {
  const reasons: string[] = [];

  if (settings.livemode !== true) reasons.push("STRIPE_TAX_SETTINGS_NOT_LIVE");
  if (settings.status !== "active") reasons.push("STRIPE_TAX_SETTINGS_NOT_ACTIVE");

  const address = settings.head_office?.address;
  if (
    !address?.line1 ||
    !address.city ||
    !address.state ||
    !address.postal_code ||
    !address.country
  ) {
    reasons.push("STRIPE_TAX_HEAD_OFFICE_INCOMPLETE");
  }

  if (!settings.defaults?.tax_behavior) reasons.push("STRIPE_TAX_BEHAVIOR_MISSING");
  if (!settings.defaults?.tax_code) reasons.push("STRIPE_DEFAULT_TAX_CODE_MISSING");

  const activeRegistrations = registrations.filter(
    registration => registration.livemode === true && registration.status === "active",
  );

  if (activeRegistrations.length === 0) {
    reasons.push("STRIPE_LIVE_TAX_REGISTRATION_MISSING");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    activeRegistrationCount: activeRegistrations.length,
  };
}
