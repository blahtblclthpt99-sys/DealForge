import { requireAdmin } from "@/lib/auth";

export async function requireDealForgeOwner() {
  const user = await requireAdmin();
  const ownerEmail = (
    process.env.DEALFORGE_OWNER_EMAIL || process.env.PRODUCT_ENGINE_OWNER_EMAIL || ""
  )
    .trim()
    .toLowerCase();

  if (!ownerEmail || user.email.trim().toLowerCase() !== ownerEmail) {
    throw new Error("FORBIDDEN");
  }

  return user;
}
