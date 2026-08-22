import { prisma } from "@/lib/db";

export type OwnerCandidate = {
  id: string;
  email: string;
  role: string;
};

function configuredOwnerEmail() {
  return (
    process.env.PRODUCT_ENGINE_OWNER_EMAIL?.trim().toLowerCase() ||
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
    ""
  );
}

/**
 * Product intake is stricter than ordinary admin access.
 * Prefer an explicitly configured owner email. If production has not set one
 * yet, only the oldest administrator can use owner tools, so adding another
 * admin never grants access automatically.
 */
export async function isProductOwner(user: OwnerCandidate | null | undefined) {
  if (!user || user.role !== "admin") return false;

  const configured = configuredOwnerEmail();
  if (configured) return user.email.trim().toLowerCase() === configured;

  const oldestAdmin = await prisma.user.findFirst({
    where: { role: "admin" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return oldestAdmin?.id === user.id;
}
