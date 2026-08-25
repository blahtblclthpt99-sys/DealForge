import { createHash, createHmac, randomUUID } from "node:crypto";

const baseUrl = (process.env.DEALFORGE_BASE_URL || "https://www.deal-forge.sale").replace(/\/$/, "");
const adapterId = (process.env.INVENTORY_ADAPTER_CERT_ID || "dealforge-phase3-cert-v1").trim();
const sourceKey = (process.env.INVENTORY_ADAPTER_CERT_SOURCE || "certification:phase3").trim();
const secret = (process.env.INVENTORY_ADAPTER_CERT_SECRET || "").trim();

if (secret.length < 32) throw new Error("INVENTORY_ADAPTER_CERT_SECRET must contain at least 32 characters");

const body = JSON.stringify({ action: "certify" });

function signedHeaders(timestamp, nonce) {
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  const payload = [adapterId, sourceKey, timestamp, nonce, bodySha256].join("\n");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");

  return {
    "content-type": "application/json",
    "x-dealforge-adapter-id": adapterId,
    "x-dealforge-source-key": sourceKey,
    "x-dealforge-timestamp": timestamp,
    "x-dealforge-nonce": nonce,
    "x-dealforge-signature": signature,
  };
}

async function post(headers) {
  const response = await fetch(`${baseUrl}/api/internal/inventory-adapter-certification`, {
    method: "POST",
    headers,
    body,
    redirect: "error",
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep null so the diagnostic below remains bounded and never prints a secret.
  }
  return { status: response.status, json };
}

let certified = null;
let headers = null;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  headers = signedHeaders(timestamp, nonce);
  certified = await post(headers);

  if (
    certified.status === 200 &&
    certified.json?.ok === true &&
    certified.json?.certified === true &&
    certified.json?.protocol === "inventory-adapter-hmac-v1" &&
    certified.json?.adapterId === adapterId &&
    certified.json?.sourceKey === sourceKey
  ) {
    break;
  }

  if (attempt === 12) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

if (
  !certified ||
  certified.status !== 200 ||
  certified.json?.ok !== true ||
  certified.json?.certified !== true ||
  certified.json?.protocol !== "inventory-adapter-hmac-v1" ||
  certified.json?.adapterId !== adapterId ||
  certified.json?.sourceKey !== sourceKey ||
  !headers
) {
  throw new Error(`Signed adapter certification failed: HTTP ${certified?.status ?? "unknown"}`);
}

console.log(`Signed adapter certification passed for ${adapterId}/${sourceKey}.`);

const replay = await post(headers);
if (replay.status !== 409 || replay.json?.error !== "ADAPTER_REPLAY_DETECTED") {
  throw new Error(`Replay protection certification failed: HTTP ${replay.status}`);
}

console.log("Durable nonce replay protection passed.");
