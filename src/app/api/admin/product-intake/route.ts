import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProductOwner } from "@/lib/owner-access";
import {
  addOwnerAmazonProduct,
  refreshOwnerIntakeQueue,
} from "@/lib/owner-product-intake";
import { runMaintenanceOnce } from "@/workers/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    value: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("refresh") }),
]);

async function currentOwner() {
  const session = await readSession();
  if (!session) return { error: "Unauthorized" as const, status: 401 as const };

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  if (!user || !(await isProductOwner(user))) {
    return { error: "Forbidden" as const, status: 403 as const };
  }
  return { user };
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await currentOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const raw = await readJson(req);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner product request" }, { status: 400 });
  }

  try {
    if (parsed.data.action === "add") {
      const result = await addOwnerAmazonProduct(parsed.data.value);
      return NextResponse.json({ ok: true, ...result });
    }

    const queue = await refreshOwnerIntakeQueue(10);
    const maintenance = await runMaintenanceOnce({
      priceRefreshLimit: 20,
      refreshTrending: false,
      expireFlashDeals: true,
      cleanCache: true,
      processPriceAlerts: true,
    });
    return NextResponse.json({ ok: true, queue, maintenance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Owner product action failed";
    console.error("Owner product intake failed", error);
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 400 });
  }
}
