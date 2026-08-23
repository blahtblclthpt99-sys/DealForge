import { NextResponse } from "next/server";
import { runMaintenanceOnce } from "@/workers/maintenance";
import { quarantineUnsafeDirectCommerce } from "@/workers/commerce-safety";
import { monitorOrderOperations } from "@/workers/order-operations-monitor";
import { refreshOwnerIntakeQueue } from "@/lib/owner-product-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_HEADER = "x-dealforge-maintenance-signature";
const TIMESTAMP_HEADER = "x-dealforge-maintenance-timestamp";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const encoder = new TextEncoder();

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    output[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return output;
}

async function validMaintenanceRequest(req: Request) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;

  const timestampValue = req.headers.get(TIMESTAMP_HEADER)?.trim() || "";
  if (!/^\d{13}$/.test(timestampValue)) return false;
  const timestamp = Number(timestampValue);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const signature = hexToBytes(req.headers.get(SIGNATURE_HEADER)?.trim() || "");
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(`dealforge-maintenance:${timestampValue}`),
  );
}

export async function POST(req: Request) {
  if (!(await validMaintenanceRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Commerce safety is release-critical: run it before lower-priority catalog
    // maintenance so stale/drifted active products fail closed as quickly as possible.
    const commerceSafety = await quarantineUnsafeDirectCommerce(500);

    // Order operations monitoring is observational only. It records deduplicated
    // owner alerts for paid orders that exceed fulfillment-stage SLA thresholds.
    const orderOperations = await monitorOrderOperations(200);

    let ownerQueue:
      | Awaited<ReturnType<typeof refreshOwnerIntakeQueue>>
      | { status: "error"; queued: number; updated: number };
    try {
      ownerQueue = await refreshOwnerIntakeQueue(10);
    } catch (error) {
      console.error("Owner ASIN queue refresh failed", error);
      ownerQueue = { status: "error", queued: 0, updated: 0 };
    }

    // Public discovery ranks directly from click/view/recency fields, so the
    // legacy full-catalog trending rewrite is not part of the Cloudflare cron.
    const result = await runMaintenanceOnce({
      priceRefreshLimit: 20,
      refreshTrending: false,
      expireFlashDeals: true,
      cleanCache: true,
      processPriceAlerts: true,
    });
    return NextResponse.json({ ok: true, commerceSafety, ownerQueue, orderOperations, ...result });
  } catch (error) {
    console.error("DealForge maintenance route failed", error);
    return NextResponse.json({ error: "Maintenance failed" }, { status: 500 });
  }
}
