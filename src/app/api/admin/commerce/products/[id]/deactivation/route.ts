import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProductOwner } from "@/lib/owner-access";
import { parseJson } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  confirm: z.literal("DEACTIVATE_DIRECT_COMMERCE"),
  reason: z.enum([
    "manual_pause",
    "source_changed",
    "pricing_review",
    "fulfillment_pause",
    "emergency",
  ]),
  note: z.string().trim().max(300).optional(),
});

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

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await currentOwner();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid deactivation request" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid deactivation request" }, { status: 400 });
  }

  const { id } = await context.params;
  const deactivatedAt = new Date();

  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          title: true,
          commerceEnabled: true,
          specifications: true,
        },
      });
      if (!current) throw new Error("DEACTIVATION_PRODUCT_NOT_FOUND");
      if (!current.commerceEnabled) throw new Error("DEACTIVATION_ALREADY_DISABLED");

      const specifications = parseJson<Record<string, unknown>>(current.specifications, {});
      const nextSpecifications = JSON.stringify({
        ...specifications,
        commerceDeactivation: {
          status: "inactive",
          deactivatedAt: deactivatedAt.toISOString(),
          deactivatedByUserId: auth.user.id,
          reason: parsed.data.reason,
          note: parsed.data.note || null,
        },
      });

      const write = await tx.product.updateMany({
        where: {
          id: current.id,
          commerceEnabled: true,
          specifications: current.specifications,
        },
        data: {
          commerceEnabled: false,
          specifications: nextSpecifications,
        },
      });
      if (write.count !== 1) throw new Error("DEACTIVATION_CONCURRENT_CHANGE");

      await tx.systemLog.create({
        data: {
          level: "warn",
          source: "commerce-deactivation",
          message: `Owner deactivated direct commerce for ${current.id}`,
          meta: JSON.stringify({
            productId: current.id,
            deactivatedByUserId: auth.user.id,
            reason: parsed.data.reason,
            note: parsed.data.note || null,
          }),
        },
      });

      return {
        id: current.id,
        slug: current.slug,
        title: current.title,
        commerceEnabled: false,
      };
    });

    return NextResponse.json({ ok: true, deactivated: true, product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "DEACTIVATION_PRODUCT_NOT_FOUND") {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (message === "DEACTIVATION_ALREADY_DISABLED") {
      return NextResponse.json({ error: "Product is already inactive" }, { status: 409 });
    }
    if (message === "DEACTIVATION_CONCURRENT_CHANGE") {
      return NextResponse.json({ error: "Product changed during deactivation; retry" }, { status: 409 });
    }
    throw error;
  }
}
