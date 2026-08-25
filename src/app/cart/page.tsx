import type { Metadata } from "next";
import { CartClient } from "@/components/cart-client";
import { readSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Cart",
  description: "Review your DealForge cart and confirmed customer-friendly pricing.",
};

export default async function CartPage() {
  const session = await readSession();
  return (
    <main className="dn-container py-10 md:py-14">
      <CartClient initialEmail={session?.email ?? ""} />
    </main>
  );
}
