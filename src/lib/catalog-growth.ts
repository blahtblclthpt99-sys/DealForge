import { createHash } from "node:crypto";
import { recommendCommercialPrice } from "@/lib/commercialization";

export const CATALOG_GROWTH_VERSION = "catalog-growth-v1";
export const MAX_SUPPLIER_CSV_ROWS = 500;
export const MAX_BUNDLE_ITEMS = 8;
export const MIN_BUNDLE_ITEMS = 2;

export type SupplierCsvRow = {
  supplierName: string;
  supplierKey: string;
  sourceClass: "manufacturer" | "wholesale" | "distributor" | "authorized_dropshipper" | "retailer_permitting_resale";
  externalId: string;
  upc: string | null;
  gtin: string | null;
  mpn: string | null;
  title: string;
  brand: string;
  category: string;
  sourceUrl: string;
  imageUrl: string | null;
  currency: string;
  itemCostCents: number;
  shippingCents: number;
  supplierFeeCents: number;
  handlingCents: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
  inventoryConfidenceBps: number;
  observedAt: string;
};

export type BundleComponent = {
  productId: string;
  title: string;
  categoryId: string;
  currency: string;
  landedCostCents: number;
  sellingPriceCents: number;
  availability: string;
  priceVerifiedAt: Date | null;
};

export type BundleProposal = {
  key: string;
  title: string;
  productIds: string[];
  currency: string;
  landedCostCents: number;
  componentRetailCents: number;
  recommendedPriceCents: number;
  minimumSafePriceCents: number;
  contributionProfitCents: number;
  contributionMarginBps: number;
  customerSavingsCents: number;
  eligible: boolean;
  reasons: string[];
};

function splitCsvLine(line: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      fields.push(value.trim());
      value = "";
      continue;
    }
    value += ch;
  }
  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  fields.push(value.trim());
  return fields;
}

function text(value: string | undefined, field: string, max: number) {
  const cleaned = (value ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > max) throw new Error(`${field.toUpperCase()}_INVALID`);
  return cleaned;
}

function optionalId(value: string | undefined, max = 64) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (cleaned.length > max || !/^[A-Za-z0-9._:/-]+$/.test(cleaned)) throw new Error("IDENTIFIER_INVALID");
  return cleaned;
}

function cents(value: string | undefined, field: string, positive = false) {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0 || (positive && dollars <= 0)) throw new Error(`${field.toUpperCase()}_INVALID`);
  const result = Math.round(dollars * 100);
  if (!Number.isSafeInteger(result) || result < 0 || (positive && result <= 0)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return result;
}

function bps(value: string | undefined) {
  const parsed = value?.trim() ? Number(value) : 9000;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) throw new Error("INVENTORY_CONFIDENCE_BPS_INVALID");
  return parsed;
}

function safeHttpsUrl(value: string | undefined, optional = false) {
  const cleaned = (value ?? "").trim();
  if (!cleaned && optional) return null;
  const url = new URL(cleaned);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("SOURCE_URL_INVALID");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal") ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error("SOURCE_URL_PRIVATE_HOST");
  return url.toString().slice(0, 2000);
}

function sourceClass(value: string | undefined): SupplierCsvRow["sourceClass"] {
  const allowed = ["manufacturer", "wholesale", "distributor", "authorized_dropshipper", "retailer_permitting_resale"] as const;
  if (!allowed.includes(value?.trim() as (typeof allowed)[number])) throw new Error("SOURCE_CLASS_INVALID");
  return value!.trim() as SupplierCsvRow["sourceClass"];
}

function availability(value: string | undefined): SupplierCsvRow["availability"] {
  const normalized = (value ?? "unknown").trim().toLowerCase();
  if (normalized !== "in_stock" && normalized !== "out_of_stock" && normalized !== "unknown") throw new Error("AVAILABILITY_INVALID");
  return normalized;
}

function timestamp(value: string | undefined) {
  const cleaned = text(value, "observed_at", 64);
  const ms = Date.parse(cleaned);
  if (!Number.isFinite(ms) || ms > Date.now() + 300_000) throw new Error("OBSERVED_AT_INVALID");
  return new Date(ms).toISOString();
}

export function canonicalIdentifier(row: Pick<SupplierCsvRow, "supplierKey" | "externalId" | "upc" | "gtin" | "mpn">) {
  if (row.gtin) return `gtin:${row.gtin.toLowerCase()}`;
  if (row.upc) return `upc:${row.upc.toLowerCase()}`;
  if (row.mpn) return `mpn:${row.mpn.toLowerCase()}`;
  return `supplier:${row.supplierKey.toLowerCase()}:${row.externalId.toLowerCase()}`;
}

export function parseSupplierCsv(csv: string): SupplierCsvRow[] {
  if (typeof csv !== "string" || !csv.trim()) throw new Error("CSV_REQUIRED");
  if (Buffer.byteLength(csv, "utf8") > 512 * 1024) throw new Error("CSV_TOO_LARGE");
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV_EMPTY");
  if (lines.length - 1 > MAX_SUPPLIER_CSV_ROWS) throw new Error("CSV_ROW_LIMIT");
  const headers = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const required = ["supplier_name", "supplier_key", "source_class", "external_id", "title", "brand", "category", "source_url", "currency", "item_cost", "availability", "observed_at"];
  for (const key of required) if (!headers.includes(key)) throw new Error(`CSV_MISSING_${key.toUpperCase()}`);
  if (new Set(headers).size !== headers.length) throw new Error("CSV_DUPLICATE_HEADER");

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    if (values.length !== headers.length) throw new Error(`CSV_ROW_${index + 2}_COLUMN_COUNT`);
    const item = Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    const currency = text(item.currency, "currency", 3).toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("CURRENCY_INVALID");
    return {
      supplierName: text(item.supplier_name, "supplier_name", 160),
      supplierKey: text(item.supplier_key, "supplier_key", 100).toLowerCase(),
      sourceClass: sourceClass(item.source_class),
      externalId: text(item.external_id, "external_id", 128),
      upc: optionalId(item.upc),
      gtin: optionalId(item.gtin),
      mpn: optionalId(item.mpn),
      title: text(item.title, "title", 500),
      brand: text(item.brand, "brand", 160),
      category: text(item.category, "category", 100),
      sourceUrl: safeHttpsUrl(item.source_url)!,
      imageUrl: safeHttpsUrl(item.image_url, true),
      currency,
      itemCostCents: cents(item.item_cost, "item_cost", true),
      shippingCents: cents(item.shipping ?? "0", "shipping"),
      supplierFeeCents: cents(item.supplier_fee ?? "0", "supplier_fee"),
      handlingCents: cents(item.handling ?? "0", "handling"),
      availability: availability(item.availability),
      inventoryConfidenceBps: bps(item.inventory_confidence_bps),
      observedAt: timestamp(item.observed_at),
    };
  });
}

export function supplierRowPrice(row: SupplierCsvRow) {
  return recommendCommercialPrice({
    itemCostCents: row.itemCostCents,
    shippingCents: row.shippingCents,
    taxCents: 0,
    supplierFeeCents: row.supplierFeeCents,
    handlingCents: row.handlingCents,
    acquisitionReserveCents: 0,
  });
}

export function buildBundleProposal(title: string, components: BundleComponent[]): BundleProposal {
  const cleanedTitle = text(title, "bundle_title", 200);
  if (components.length < MIN_BUNDLE_ITEMS || components.length > MAX_BUNDLE_ITEMS) throw new Error("BUNDLE_COMPONENT_COUNT_INVALID");
  if (new Set(components.map((item) => item.productId)).size !== components.length) throw new Error("BUNDLE_DUPLICATE_COMPONENT");
  const currencies = new Set(components.map((item) => item.currency.toLowerCase()));
  if (currencies.size !== 1) throw new Error("BUNDLE_CURRENCY_MISMATCH");
  const currency = [...currencies][0];
  const reasons: string[] = [];
  let landedCostCents = 0;
  let componentRetailCents = 0;
  for (const component of components) {
    if (!Number.isSafeInteger(component.landedCostCents) || component.landedCostCents <= 0) reasons.push(`missing_cost:${component.productId}`);
    if (!Number.isSafeInteger(component.sellingPriceCents) || component.sellingPriceCents <= 0) reasons.push(`missing_price:${component.productId}`);
    if (component.availability !== "in_stock") reasons.push(`not_in_stock:${component.productId}`);
    if (!component.priceVerifiedAt) reasons.push(`price_unverified:${component.productId}`);
    landedCostCents += Math.max(0, component.landedCostCents || 0);
    componentRetailCents += Math.max(0, component.sellingPriceCents || 0);
  }
  if (!Number.isSafeInteger(landedCostCents) || landedCostCents <= 0) throw new Error("BUNDLE_LANDED_COST_INVALID");
  const price = recommendCommercialPrice({
    itemCostCents: landedCostCents,
    shippingCents: 0,
    taxCents: 0,
    supplierFeeCents: 0,
    handlingCents: 0,
    acquisitionReserveCents: 0,
    marketReferenceCents: componentRetailCents > 0 ? componentRetailCents : null,
    maxMarketPremiumBps: 0,
  });
  if (!price.marketCompatible) reasons.push(...price.reasons);
  const customerSavingsCents = Math.max(0, componentRetailCents - price.recommendedPriceCents);
  if (customerSavingsCents <= 0) reasons.push("no_customer_bundle_savings");
  const eligible = reasons.length === 0;
  const key = createHash("sha256").update(`${currency}|${cleanedTitle}|${components.map((item) => item.productId).sort().join("|")}`).digest("hex").slice(0, 32);
  return {
    key: `bundle:${key}`,
    title: cleanedTitle,
    productIds: components.map((item) => item.productId),
    currency,
    landedCostCents,
    componentRetailCents,
    recommendedPriceCents: price.recommendedPriceCents,
    minimumSafePriceCents: price.minimumSafePriceCents,
    contributionProfitCents: price.contributionProfitCents,
    contributionMarginBps: price.contributionMarginBps,
    customerSavingsCents,
    eligible,
    reasons: Array.from(new Set(reasons)),
  };
}
