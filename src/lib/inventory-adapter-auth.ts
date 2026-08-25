import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_TTL_SECONDS = 10 * 60;
const MAX_ADAPTER_ID = 120;
const MAX_SOURCE_KEY = 180;
const MAX_NONCE = 180;

export type InventoryAdapterIdentity = {
  adapterId: string;
  sourceKey: string;
};

type AdapterSecretEntry = {
  secret: string;
  sourceKeys: string[];
};

type AdapterSecretMap = Record<string, AdapterSecretEntry>;

function clean(value: string | null, field: string, maxLength: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > maxLength) throw new Error(`ADAPTER_${field}_INVALID`);
  return normalized;
}

function parseSecrets(): AdapterSecretMap | null {
  const raw = process.env.INVENTORY_ADAPTER_SECRETS_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: AdapterSecretMap = {};
    for (const [adapterId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const secret = typeof entry.secret === "string" ? entry.secret.trim() : "";
      const sourceKeys = Array.isArray(entry.sourceKeys)
        ? entry.sourceKeys.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
      if (adapterId.trim() && secret.length >= 32 && sourceKeys.length > 0) {
        result[adapterId.trim()] = { secret, sourceKeys: [...new Set(sourceKeys)] };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function signaturePayload(input: {
  adapterId: string;
  sourceKey: string;
  timestamp: string;
  nonce: string;
  body: string;
}) {
  const bodySha256 = createHash("sha256").update(input.body).digest("hex");
  return [input.adapterId, input.sourceKey, input.timestamp, input.nonce, bodySha256].join("\n");
}

function safeSignatureEqual(expectedHex: string, suppliedHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function consumeNonce(input: {
  adapterId: string;
  sourceKey: string;
  nonce: string;
  timestampMs: number;
}) {
  const nonceHash = createHash("sha256")
    .update(`${input.adapterId}\n${input.sourceKey}\n${input.nonce}`)
    .digest("hex");
  const expiresAt = new Date(input.timestampMs + NONCE_TTL_SECONDS * 1000);
  const inserted = await prisma.$executeRaw`
    INSERT INTO "InventoryAdapterNonce" (
      "id", "nonceHash", "adapterId", "sourceKey", "expiresAt", "createdAt"
    ) VALUES (
      ${`adapter_nonce_${randomUUID()}`}, ${nonceHash}, ${input.adapterId}, ${input.sourceKey}, ${expiresAt}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("nonceHash") DO NOTHING
  `;
  if (inserted !== 1) throw new Error("ADAPTER_REPLAY_DETECTED");
}

/**
 * Verify an adapter request before parsing or acting on its JSON payload.
 * Authentication is disabled-by-default: if no secret map is configured, all
 * machine requests fail closed.
 */
export async function authenticateInventoryAdapterRequest(input: {
  headers: Headers;
  body: string;
  nowMs?: number;
}): Promise<InventoryAdapterIdentity> {
  const secrets = parseSecrets();
  if (!secrets) throw new Error("ADAPTER_AUTH_NOT_CONFIGURED");

  const adapterId = clean(input.headers.get("x-dealforge-adapter-id"), "ID", MAX_ADAPTER_ID);
  const sourceKey = clean(input.headers.get("x-dealforge-source-key"), "SOURCE_KEY", MAX_SOURCE_KEY);
  const timestamp = clean(input.headers.get("x-dealforge-timestamp"), "TIMESTAMP", 32);
  const nonce = clean(input.headers.get("x-dealforge-nonce"), "NONCE", MAX_NONCE);
  const suppliedSignature = clean(input.headers.get("x-dealforge-signature"), "SIGNATURE", 128);

  const entry = secrets[adapterId];
  if (!entry || !entry.sourceKeys.includes(sourceKey)) throw new Error("ADAPTER_SCOPE_FORBIDDEN");

  const timestampMs = Date.parse(timestamp);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_SECONDS * 1000) {
    throw new Error("ADAPTER_TIMESTAMP_INVALID");
  }

  const expectedSignature = createHmac("sha256", entry.secret)
    .update(signaturePayload({ adapterId, sourceKey, timestamp, nonce, body: input.body }))
    .digest("hex");
  if (!safeSignatureEqual(expectedSignature, suppliedSignature)) {
    throw new Error("ADAPTER_SIGNATURE_INVALID");
  }

  await consumeNonce({ adapterId, sourceKey, nonce, timestampMs });
  return { adapterId, sourceKey };
}
