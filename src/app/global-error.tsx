"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#0b0b0c",
          color: "#f8f7f5",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 560,
            padding: "36px 28px",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 24,
            background: "linear-gradient(145deg, rgba(255,255,255,.07), rgba(255,255,255,.035))",
            boxShadow: "0 28px 70px rgba(0,0,0,.35)",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              margin: "0 auto",
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              background: "rgba(249,115,22,.14)",
              color: "#fb923c",
              fontWeight: 900,
              fontSize: 22,
            }}
          >
            !
          </div>
          <p style={{ margin: "18px 0 0", color: "#fb923c", fontSize: 12, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>
            DealForge
          </p>
          <h1 style={{ margin: "8px 0 0", fontSize: 34, lineHeight: 1.08, letterSpacing: "-.025em" }}>
            We couldn’t load DealForge
          </h1>
          <p style={{ margin: "14px auto 0", maxWidth: 440, color: "rgba(255,255,255,.62)", fontSize: 14, lineHeight: 1.65 }}>
            A temporary application error prevented this page from loading. Try the request again; if the problem continues, return to the storefront in a new tab.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 48,
              marginTop: 24,
              border: "1px solid #ea580c",
              borderRadius: 999,
              padding: "0 22px",
              background: "#f97316",
              color: "white",
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
