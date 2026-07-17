"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 40, textAlign: "center" }}>
        <h1>DealForge</h1>
        <p>Application error{error.digest ? ` (${error.digest})` : ""}.</p>
        <p style={{ color: "#666", maxWidth: 480, margin: "12px auto" }}>
          Production requires a PostgreSQL DATABASE_URL (e.g. Neon). Local SQLite does not work on
          Vercel.
        </p>
        <button type="button" onClick={reset} style={{ padding: "8px 16px" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
