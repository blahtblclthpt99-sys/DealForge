import { createHmac } from "node:crypto";
import { resolveAuthSecret } from "./auth-secret";

type MaintenanceEnv = {
  MAINTENANCE_TOKEN?: string;
  AUTH_SECRET?: string;
};

const MIN_MAINTENANCE_TOKEN_LENGTH = 24;
const DERIVATION_CONTEXT = "dealforge:maintenance:v1";

/**
 * Resolve the credential used by internal maintenance endpoints.
 *
 * A dedicated token is preferred. For deployments that have not provisioned
 * one yet, derive a one-way, domain-separated credential from the validated
 * production auth secret rather than transmitting the JWT signing key itself.
 */
export function resolveMaintenanceToken(env?: MaintenanceEnv) {
  const source: MaintenanceEnv = env ?? {
    MAINTENANCE_TOKEN: process.env.MAINTENANCE_TOKEN,
    AUTH_SECRET: process.env.AUTH_SECRET,
  };
  const dedicated = (source.MAINTENANCE_TOKEN || "").trim();
  if (dedicated) {
    return dedicated.length >= MIN_MAINTENANCE_TOKEN_LENGTH ? dedicated : "";
  }

  try {
    const authSecret = resolveAuthSecret({
      AUTH_SECRET: source.AUTH_SECRET,
      NODE_ENV: "production",
    });
    return createHmac("sha256", authSecret).update(DERIVATION_CONTEXT).digest("hex");
  } catch {
    return "";
  }
}
