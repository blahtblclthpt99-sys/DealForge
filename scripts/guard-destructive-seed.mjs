const CONFIRMATION = "I_UNDERSTAND_DATA_WILL_BE_DELETED";
const BLOCKED_ADMIN_PASSWORDS = new Set([
  "AdminDealForge2026!",
  "ChangeMeAdmin123!",
]);

function fail(message) {
  console.error(`[DealForge seed guard] ${message}`);
  process.exit(1);
}

const databaseUrl = (process.env.DATABASE_URL || "").trim();
if (!databaseUrl) fail("DATABASE_URL is required before seeding.");

const localSqlite = databaseUrl.startsWith("file:");
const production = process.env.NODE_ENV === "production";
const confirmation = (process.env.ALLOW_DESTRUCTIVE_SEED || "").trim();

if ((production || !localSqlite) && confirmation !== CONFIRMATION) {
  fail(
    "Refusing destructive seed against production or a non-local database. " +
      `Set ALLOW_DESTRUCTIVE_SEED=${CONFIRMATION} only for an intentional reset.`,
  );
}

if (production || !localSqlite) {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (!adminEmail || !adminEmail.includes("@")) {
    fail("ADMIN_EMAIL must be explicitly configured for a production or non-local destructive seed.");
  }
  if (adminPassword.length < 16 || BLOCKED_ADMIN_PASSWORDS.has(adminPassword)) {
    fail(
      "ADMIN_PASSWORD must be explicitly configured with at least 16 characters and must not use a known default.",
    );
  }
}

console.log(
  localSqlite && !production
    ? "[DealForge seed guard] local SQLite destructive seed allowed."
    : "[DealForge seed guard] explicit destructive reset confirmed for protected database.",
);
