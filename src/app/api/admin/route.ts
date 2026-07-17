import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [
    productCount,
    userCount,
    clickCount,
    providers,
    importJobs,
    errorLogs,
    apiUsage,
    cacheEntries,
    topProducts,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.user.count(),
    prisma.clickEvent.count(),
    prisma.affiliateProvider.findMany({ orderBy: { provider: "asc" } }),
    prisma.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.systemLog.findMany({ where: { level: "error" }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.apiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.cacheEntry.count(),
    prisma.product.findMany({
      orderBy: { clickCount: "desc" },
      take: 8,
      select: { id: true, title: true, clickCount: true, viewCount: true, discountPercent: true },
    }),
  ]);

  return NextResponse.json({
    stats: {
      productCount,
      userCount,
      clickCount,
      cacheEntries,
      ctr:
        clickCount > 0
          ? Math.round(
              (clickCount /
                Math.max(
                  1,
                  (
                    await prisma.product.aggregate({ _sum: { viewCount: true } })
                  )._sum.viewCount || 1,
                )) *
                1000,
            ) / 10
          : 0,
    },
    providers,
    importJobs,
    errorLogs,
    apiUsage,
    topProducts,
  });
}

export async function PATCH(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  if (body.type === "provider") {
    const updated = await prisma.affiliateProvider.update({
      where: { id: body.id },
      data: {
        enabled: body.enabled,
        trackingId: body.trackingId ?? undefined,
      },
    });
    return NextResponse.json({ ok: true, provider: updated });
  }

  if (body.type === "user-role") {
    const updated = await prisma.user.update({
      where: { id: body.id },
      data: { role: body.role },
    });
    return NextResponse.json({
      ok: true,
      user: { id: updated.id, email: updated.email, role: updated.role },
    });
  }

  if (body.type === "product") {
    const updated = await prisma.product.update({
      where: { id: body.id },
      data: {
        price: body.price,
        originalPrice: body.originalPrice,
        isFeatured: body.isFeatured,
        isFlashDeal: body.isFlashDeal,
        availability: body.availability,
      },
    });
    return NextResponse.json({ ok: true, product: updated });
  }

  void parseJson;
  return NextResponse.json({ error: "Unknown update" }, { status: 400 });
}
