"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="dn-container flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-forest">DealForge</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-forest-ink">Something went wrong</h1>
      <p className="mt-3 max-w-md text-sm text-forest-muted">
        {error.message || "A server error occurred."}
        {error.digest ? ` (digest ${error.digest})` : ""}
      </p>
      <p className="mt-4 max-w-lg text-sm text-forest-muted">
        On Vercel, DealForge needs a PostgreSQL <code className="rounded bg-forest/10 px-1">DATABASE_URL</code>{" "}
        (Neon). SQLite will not work in production.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
