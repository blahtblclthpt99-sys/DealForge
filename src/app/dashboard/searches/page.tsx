import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { DeleteSearchButton } from "@/components/delete-search-button";
import { readSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/utils";

type SavedSearch = {
  id: string;
  query: string;
  filters: Record<string, string>;
  createdAt: string;
};

function filterSummary(filters: Record<string, string>) {
  return Object.entries(filters || {})
    .filter(([, value]) => Boolean(value))
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value}`)
    .join(" · ");
}

export default async function SavedSearchesPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/searches");
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");
  const searches = parseJson<SavedSearch[]>(user.savedSearches, []);

  return (
    <div className="dn-container py-10 sm:py-12 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-forest hover:underline">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.14em] text-forest">Saved discovery</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-forest-ink sm:text-5xl">Saved searches</h1>
          <p className="mt-2 text-sm leading-6 text-forest-muted">Return to useful queries and catalog filters without rebuilding them.</p>
        </div>
        <Link href="/search" className="dn-button-primary">
          <Search className="h-4 w-4" /> New search
        </Link>
      </div>

      {searches.length > 0 ? (
        <div className="mt-8 grid gap-3">
          {searches.map((search) => {
            const params = new URLSearchParams();
            if (search.query) params.set("q", search.query);
            Object.entries(search.filters || {}).forEach(([key, value]) => {
              if (value) params.set(key, String(value));
            });
            const summary = filterSummary(search.filters || {});

            return (
              <article key={search.id} className="dn-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-forest-muted">Saved search</p>
                  <Link href={`/search?${params.toString()}`} className="mt-1.5 inline-flex items-center gap-1.5 font-extrabold text-forest-ink hover:text-forest">
                    <span className="truncate">{search.query || "Filtered browse"}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                  {summary ? <p className="mt-1 text-xs leading-5 text-forest-muted">{summary}</p> : null}
                  <p className="mt-1 text-[11px] text-forest-muted/80">Saved {new Date(search.createdAt).toLocaleString()}</p>
                </div>
                <DeleteSearchButton id={search.id} />
              </article>
            );
          })}
        </div>
      ) : (
        <section className="dn-card mt-8 px-5 py-12 text-center sm:py-16">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/9 text-forest">
            <Search className="h-5 w-5" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold text-forest-ink">No searches saved yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-forest-muted">Use “Save this search” in Product Finder when you want to keep a useful query and its filters.</p>
          <Link href="/search" className="dn-button-primary mt-5">
            Open Product Finder <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}
    </div>
  );
}
