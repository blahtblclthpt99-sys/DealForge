import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { loadCertifiedOrderProfit } from "@/lib/certified-order-profit";
import { currentSavingsFundPolicy } from "@/lib/customer-savings-fund";
import { prisma } from "@/lib/db";
import {
  getShadowSavingsFundBalance,
  listRecentShadowSavingsFundEntries,
  reconcileShadowSavingsFundOrder,
} from "@/lib/savings-fund-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReconcileSchema = z.object({
  orderId: z.string().trim().min(1).max(128).optional(),
  trailingDays: z.number().int().min(1).max(90).default(30),
});

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function authorizeAdmin() {
  try {
    await requireAdmin();
    return null;
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return noStore(
      NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status }),
    );
  }
}

export async function GET(request: Request) {
  const auth = await authorizeAdmin();
  if (auth) return auth;

  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") || "usd").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) {
    return noStore(NextResponse.json({ error: "CURRENCY_INVALID" }, { status: 400 }));
  }

  const policy = currentSavingsFundPolicy();
  const balance = await getShadowSavingsFundBalance(currency);
  let recentEntries: Awaited<ReturnType<typeof listRecentShadowSavingsFundEntries>> = [];
  if (balance.available) {
    try {
      recentEntries = await listRecentShadowSavingsFundEntries(50);
    } catch (error) {
      console.warn("savings_fund.entries.unavailable", {
        error: error instanceof Error ? error.message : "UNKNOWN",
      });
    }
  }

  return noStore(NextResponse.json({
    phase: "A",
    mode: "measure_only",
    appliesToCheckout: false,
    automaticReleaseEnabled: false,
    policy,
    balance,
    recentEntries,
  }));
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if (auth) return auth;

  const raw = await request.json().catch(() => ({}));
  const parsed = ReconcileSchema.safeParse(raw);
  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "INVALID_RECONCILIATION_REQUEST" }, { status: 400 }));
  }

  const orderIds = parsed.data.orderId
    ? [parsed.data.orderId]
    : (await prisma.order.findMany({
        where: {
          status: { in: ["paid", "partially_refunded", "refunded"] },
          createdAt: { gte: new Date(Date.now() - parsed.data.trailingDays * 86_400_000) },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 250,
      })).map((order) => order.id);

  const results: Array<Record<string, unknown>> = [];
  for (const orderId of orderIds) {
    try {
      const loaded = await loadCertifiedOrderProfit(orderId);
      if (!loaded) {
        results.push({ orderId, ok: false, error: "ORDER_NOT_FOUND" });
        continue;
      }
      const contribution = loaded.profit.contribution;
      const reconciliation = await reconcileShadowSavingsFundOrder({
        orderId: loaded.order.id,
        currency: loaded.order.currency,
        certified: contribution.certified,
        certifiedContributionCents: contribution.certifiedOrderContributionCents,
        reason: contribution.certified
          ? "certified_realized_order_contribution"
          : contribution.finalizationReasons.join(",") || "order_not_certified",
      });
      results.push({
        orderId,
        orderNumber: loaded.order.orderNumber,
        ok: true,
        certified: contribution.certified,
        certifiedContributionCents: contribution.certifiedOrderContributionCents,
        finalizationReasons: contribution.finalizationReasons,
        reconciliation,
      });
    } catch (error) {
      results.push({
        orderId,
        ok: false,
        error: error instanceof Error ? error.message : "UNKNOWN",
      });
    }
  }

  const failures = results.filter((result) => result.ok !== true).length;
  const changed = results.filter((result) => {
    const reconciliation = result.reconciliation as { changed?: boolean } | undefined;
    return reconciliation?.changed === true;
  }).length;
  const policy = currentSavingsFundPolicy();
  const usdBalance = await getShadowSavingsFundBalance("usd");

  return noStore(NextResponse.json({
    phase: "A",
    mode: "measure_only",
    appliesToCheckout: false,
    automaticReleaseEnabled: false,
    policy,
    scannedOrders: orderIds.length,
    changedOrders: changed,
    failures,
    usdBalance,
    results,
  }, { status: failures > 0 ? 207 : 200 }));
}
