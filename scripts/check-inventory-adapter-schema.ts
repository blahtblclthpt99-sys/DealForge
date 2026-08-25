import { prisma } from "../src/lib/db";

type SchemaContractRow = {
  table_exists: boolean;
  nonce_unique_index_exists: boolean;
  expires_index_exists: boolean;
  adapter_source_index_exists: boolean;
};

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for production schema contract verification");

  const rows = await prisma.$queryRaw<SchemaContractRow[]>`
    SELECT
      to_regclass('public."InventoryAdapterNonce"') IS NOT NULL AS table_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'InventoryAdapterNonce'
          AND indexname = 'InventoryAdapterNonce_nonceHash_key'
      ) AS nonce_unique_index_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'InventoryAdapterNonce'
          AND indexname = 'InventoryAdapterNonce_expires_idx'
      ) AS expires_index_exists,
      EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'InventoryAdapterNonce'
          AND indexname = 'InventoryAdapterNonce_adapter_source_idx'
      ) AS adapter_source_index_exists
  `;

  const contract = rows[0];
  if (
    !contract?.table_exists ||
    !contract.nonce_unique_index_exists ||
    !contract.expires_index_exists ||
    !contract.adapter_source_index_exists
  ) {
    throw new Error(
      `Inventory adapter production schema contract missing: ${JSON.stringify(contract ?? null)}`,
    );
  }

  console.log("Inventory adapter production schema contract verified.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Inventory adapter schema contract check failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
