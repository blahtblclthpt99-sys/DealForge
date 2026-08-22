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
 * Access fails closed unless an explicit owner/admin email is configured and
 * the signed-in administrator matches that email exactly. Additional admin
 * accounts never inherit product-intake privileges.
 */
export async function isProductOwner(user: OwnerCandidate | null | undefined) {
  if (!user || user.role !== "admin") return false;
  const configured = configuredOwnerEmail();
  if (!configured) return false;
  return user.email.trim().toLowerCase() === configured;
}
