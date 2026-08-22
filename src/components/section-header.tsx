import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function SectionHeader({
  title,
  subtitle,
  href,
  linkLabel = "View all",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 sm:mb-7">
      <div className="min-w-0">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-forest-ink md:text-3xl">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-forest-muted">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-2 text-sm font-extrabold text-forest transition hover:bg-forest/8">
          {linkLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
