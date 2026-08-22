import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <div className="max-w-3xl">
        <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest hover:underline">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Account controls</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-forest-ink sm:text-5xl">Account settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-forest-muted">Manage the profile details and preferences currently supported by your DealForge account.</p>
        <div className="mt-5 inline-flex items-start gap-2 rounded-xl border border-card-border bg-card px-3.5 py-3 text-xs leading-5 text-forest-muted shadow-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
          <span>Destructive account deletion still requires your current password and an explicit DELETE confirmation.</span>
        </div>
      </div>

      <div className="mt-8 max-w-3xl">
        <SettingsForm name={user.name} email={user.email} settings={settings} />
      </div>
    </div>
  );
}
