type AppUrlEnv = {
  NEXT_PUBLIC_APP_URL?: string;
  NODE_ENV?: string;
};

function parseHttpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL_INVALID");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL_PROTOCOL_INVALID");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL_CREDENTIALS_NOT_ALLOWED");
  }
  return parsed;
}

/**
 * Resolve the canonical public origin used for checkout return URLs.
 * Production must be explicitly configured so a request Host header can never
 * become the authoritative Stripe success/cancel destination by accident.
 */
export function resolvePublicAppOrigin(requestUrl: string, env: AppUrlEnv = process.env) {
  const configured = (env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!configured) {
    if (env.NODE_ENV === "production") throw new Error("APP_URL_MISSING");
    return parseHttpUrl(requestUrl).origin;
  }

  const parsed = parseHttpUrl(configured);
  if (env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("APP_URL_HTTPS_REQUIRED");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("APP_URL_MUST_BE_ORIGIN");
  }
  return parsed.origin;
}

/**
 * Normalize database-backed outbound destinations. Returning null instead of a
 * non-HTTP scheme prevents stored javascript:, data:, file:, or credentialed
 * URLs from becoming shopper-facing redirects.
 */
export function normalizeExternalHttpUrl(value: string) {
  try {
    return parseHttpUrl(value).toString();
  } catch {
    return null;
  }
}
