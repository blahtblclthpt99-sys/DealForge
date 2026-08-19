import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const idSchema = z.string().trim().min(1).max(128);

const providerPatchSchema = z.object({
  type: z.literal("provider"),
  id: idSchema,
  enabled: z.boolean(),
  trackingId: z.string().trim().max(200).optional(),
});

const userRolePatchSchema = z.object({
  type: z.literal("user-role"),
  id: idSchema,
  role: z.enum(["user", "admin"]),
});

const productPatchSchema = z.object({
  type: z.literal("product"),
  id: idSchema,
  price: z.number().finite().min(0).max(1_000_000),
  originalPrice: z.number().finite().min(0).max(1_000_000),
  isFeatured: z.boolean(),
  isFlashDeal: z.boolean(),
  availability: z.string().trim().min(1).max(40),
});

const patchSchema = z.discriminatedUnion("type", [
  providerPatchSchema,
  userRolePatchSchema,
  productPatchSchema,
]);

async function currentAdmin() {
  const session = await readSession();
  if (!session) return { error: "Unauthorized" as const, status: 401 as const };

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "admin") {
    return { error: "Forbidden" as const, status: 403 as const };
  }
  return { user };
}

async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function GET() {
  const auth = await currentAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
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
  const auth = await currentAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const raw = await readJson(req);
  if (!raw) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid admin update" }, { status: 400 });
  }
  const body = parsed.data;

  if (body.type === "provider") {
    const updated = await prisma.affiliateProvider.update({
      where: { id: body.id },
      data: {
        enabled: body.enabled,
        trackingId: body.trackingId,
      },
    });
    return NextResponse.json({ ok: true, provider: updated });
  }

  if (body.type === "user-role") {
    const target = await prisma.user.findUnique({
      where: { id: body.id },
      select: { id: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "admin" && body.role === "user") {
      const adminCount = await prisma.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the final administrator" },
          { status: 409 },
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: body.id },
      data: { role: body.role },
    });
    return NextResponse.json({
      ok: true,
      user: { id: updated.id, email: updated.email, role: updated.role },
    });
  }

  if (body.originalPrice < body.price) {
    return NextResponse.json(
      { error: "Original price cannot be lower than current price" },
      { status: 400 },
    );
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
  });
  return NextResponse.json({ ok: true, product: updated });
}
