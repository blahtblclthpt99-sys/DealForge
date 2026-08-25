import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function requireProcurementOwner() {
  const session = await requireAdmin();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, role: true },
  });
  const ownerEmail = process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase();

  if (!ownerEmail || !user || user.role !== "admin" || user.email.toLowerCase() !== ownerEmail) {
    throw new Error("FORBIDDEN");
  }

  return user;
}

export function isSameOriginProcurementMutation(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");

  if (!origin) {
    return process.env.NODE_ENV !== "production" && (!site || site === "same-origin" || site === "none");
  }

  try {
    return (
      new URL(origin).origin === new URL(request.url).origin &&
      (!site || site === "same-origin" || site === "none")
    );
  } catch {
    return false;
  }
}
