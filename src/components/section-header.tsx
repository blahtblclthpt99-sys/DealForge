import Link from "next/link";

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
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-forest-ink md:text-3xl">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-forest-muted">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-medium text-forest hover:underline">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}
