import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

const EntityId = z.string().trim().min(1).max(128);

const AdminPatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("provider"),
    id: EntityId,
    enabled: z.boolean(),
    trackingId: z.string().trim().max(256).optional(),
  }),
  z.object({
    type: z.literal("user-role"),
    id: EntityId,
    role: z.enum(["user", "admin"]),
  }),
  z.object({
    type: z.literal("product"),
    id: EntityId,
    price: z.number().finite().min(0).max(10_000_000),
    originalPrice: z.number().finite().min(0).max(10_000_000),
    isFeatured: z.boolean(),
    isFlashDeal: z.boolean(),
    availability: z.string().trim().min(1).max(32),
  }),
]);

async function authorizeAdmin() {
  try {
    return { admin: await requireAdmin(), response: null };
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 403;
    return {
      admin: null,
      response: NextResponse.json(
        { error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" },
        { status },
      ),
    };
  }
}

export async function GET() {
  const auth = await authorizeAdmin();
  if (auth.response) return auth.response;

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
    prisma.affiliateProvider.findMany({
      orderBy: { provider: "asc" },
      select: {
        id: true,
        provider: true,
        displayName: true,
        trackingId: true,
        enabled: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
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
  const auth = await authorizeAdmin();
  if (auth.response) return auth.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_ADMIN_UPDATE" }, { status: 400 });
  }

  const parsed = AdminPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_ADMIN_UPDATE", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;
  if (body.type === "provider") {
    const updated = await prisma.affiliateProvider.update({
      where: { id: body.id },
      data: {
        enabled: body.enabled,
        trackingId: body.trackingId,
      },
      select: {
        id: true,
        provider: true,
        displayName: true,
        trackingId: true,
        enabled: true,
        lastSyncStatus: true,
      },
    });
    return NextResponse.json({ ok: true, provider: updated });
  }

  if (body.type === "user-role") {
    const updated = await prisma.user.update({
      where: { id: body.id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
    });
    return NextResponse.json({ ok: true, user: updated });
  }

  const updated = await prisma.product.update({
    where: { id: body.id },
    data: {
      price: body.price,
      originalPrice: body.originalPrice,
      isFeatured: body.isFeatured,
      isFlashDeal: body.isFlashDeal,
      availability: body.availability,
    },
    select: {
      id: true,
      price: true,
      originalPrice: true,
      isFeatured: true,
      isFlashDeal: true,
      availability: true,
    },
  });
  return NextResponse.json({ ok: true, product: updated });
}
