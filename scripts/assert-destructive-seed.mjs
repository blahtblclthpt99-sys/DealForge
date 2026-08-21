const databaseUrl = (process.env.DATABASE_URL || "").trim();
const confirmation = (process.env.ALLOW_DESTRUCTIVE_SEED || "").trim();
const isLocalSqlite = databaseUrl.startsWith("file:");

if (!databaseUrl) {
  console.error(
    "[seed-guard] DATABASE_URL is not available to the seed guard. Refusing destructive seed. Set DATABASE_URL explicitly.",
  );
  process.exit(1);
}

if (isLocalSqlite) {
  console.log("[seed-guard] local SQLite database detected; destructive development seed allowed.");
  process.exit(0);
}

if (confirmation !== "RESET_DEALFORGE_DATABASE") {
  console.error(
    [
      "[seed-guard] REFUSED: DealForge seed deletes all users, products, categories, logs, cache, and provider rows.",
      "A non-SQLite database requires explicit destructive-reset confirmation.",
      "If you truly intend to erase and rebuild this database, set:",
      "ALLOW_DESTRUCTIVE_SEED=RESET_DEALFORGE_DATABASE",
      "and provide explicit ADMIN_EMAIL / ADMIN_PASSWORD values before retrying.",
    ].join("\n"),
  );
  process.exit(1);
}

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
const knownDefaults = new Set(["ChangeMeAdmin123!", "AdminDealForge2026!"]);

if (!adminEmail || !adminEmail.includes("@")) {
  console.error("[seed-guard] ADMIN_EMAIL must be explicitly configured for a non-SQLite reset.");
  process.exit(1);
}

if (adminPassword.length < 16 || knownDefaults.has(adminPassword)) {
  console.error(
    "[seed-guard] ADMIN_PASSWORD must be explicitly configured, at least 16 characters, and not a repository default.",
  );
  process.exit(1);
}

console.warn(
  `[seed-guard] DESTRUCTIVE RESET AUTHORIZED for ${databaseUrl.replace(/:\/\/[^@]+@/, "://***@")}.`,
);
