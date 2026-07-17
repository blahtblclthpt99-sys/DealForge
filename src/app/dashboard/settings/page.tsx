import Link from "next/link";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings-form";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

export default async function SettingsPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/settings");
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");
  const settings = parseJson<Record<string, unknown>>(user.settings, {});

  return (
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Account settings</h1>
      <div className="mt-8 max-w-lg">
        <SettingsForm
          name={user.name}
          email={user.email}
          settings={settings}
        />
      </div>
    </div>
  );
}
