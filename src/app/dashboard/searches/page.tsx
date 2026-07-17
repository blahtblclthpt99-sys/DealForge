import Link from "next/link";
import { redirect } from "next/navigation";
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

export default async function SavedSearchesPage() {
  const session = await readSession();
  if (!session) redirect("/login?next=/dashboard/searches");
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/login");
  const searches = parseJson<SavedSearch[]>(user.savedSearches, []);

  return (
    <div className="dn-container py-12">
      <Link href="/dashboard" className="text-sm text-forest hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest-ink">Saved searches</h1>
      <div className="mt-8 space-y-3">
        {searches.map((s) => {
          const params = new URLSearchParams();
          if (s.query) params.set("q", s.query);
          Object.entries(s.filters || {}).forEach(([k, v]) => {
            if (v) params.set(k, String(v));
          });
          return (
            <div key={s.id} className="dn-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <Link href={`/search?${params.toString()}`} className="font-semibold text-forest-ink hover:text-forest">
                  {s.query || "Filtered browse"}
                </Link>
                <p className="text-xs text-forest-muted">
                  Saved {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              <DeleteSearchButton id={s.id} />
            </div>
          );
        })}
      </div>
      {searches.length === 0 && (
        <p className="mt-10 text-center text-forest-muted">
          No saved searches. Use &quot;Save this search&quot; on the search page.
        </p>
      )}
    </div>
  );
}
