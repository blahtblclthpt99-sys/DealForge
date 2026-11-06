import { z } from "zod";

const shopifyProductQuery = `query DealForgeCatalogBridge($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id title handle descriptionHtml vendor productType status tags updatedAt
        featuredMedia { preview { image { url altText } } }
        variants(first: 50) {
          edges {
            node {
              id title sku price inventoryQuantity
              inventoryItem { unitCost { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}`;

const moneySchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
  currencyCode: z.string().length(3),
}).nullable();

const variantSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.string(),
  inventoryQuantity: z.number().int().nullable(),
  inventoryItem: z.object({ unitCost: moneySchema }).nullable(),
});

const productSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
  title: z.string().min(1),
  handle: z.string().min(1),
  descriptionHtml: z.string().nullable(),
  vendor: z.string(),
  productType: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
  updatedAt: z.string().datetime({ offset: true }),
  featuredMedia: z.object({ preview: z.object({ image: z.object({ url: z.string().url(), altText: z.string().nullable() }).nullable() }).nullable() }).nullable(),
  variants: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), edges: z.array(z.object({ node: variantSchema })) }),
});

const responseSchema = z.object({
  data: z.object({
    products: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      edges: z.array(z.object({ node: productSchema })),
    }),
  }),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

export type ShopifyCatalogVariant = z.infer<typeof variantSchema>;
export type ShopifyCatalogProduct = z.infer<typeof productSchema>;

export class ShopifyAdminError extends Error {
  constructor(
    public readonly code: "CONFIGURATION" | "UPSTREAM" | "RATE_LIMITED" | "INVALID_RESPONSE",
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

function shopDomain() {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new ShopifyAdminError("CONFIGURATION", "Shopify store domain is not configured.", 503);
  }
  return domain;
}

export async function readShopifyCatalogPage(after: string | null, first = 50) {
  const domain = shopDomain();
  const token = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "").trim();
  const version = (process.env.SHOPIFY_API_VERSION ?? "2026-10").trim();
  if (!token) throw new ShopifyAdminError("CONFIGURATION", "Shopify Admin API token is not configured.", 503);
  if (!/^\d{4}-\d{2}$/.test(version)) {
    throw new ShopifyAdminError("CONFIGURATION", "Shopify API version must use YYYY-MM format.", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        "Accept": "application/json",
      },
      body: JSON.stringify({ query: shopifyProductQuery, variables: { first, after } }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new ShopifyAdminError("UPSTREAM", "Shopify Admin API could not be reached.");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new ShopifyAdminError("RATE_LIMITED", "Shopify rate limit reached. Retry after the indicated interval.", 429);
  }
  if (!response.ok) {
    throw new ShopifyAdminError("UPSTREAM", `Shopify Admin API returned HTTP ${response.status}.`, 502);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ShopifyAdminError("INVALID_RESPONSE", "Shopify returned an unreadable response.");
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    const maybeErrors = z.object({ errors: z.array(z.object({ message: z.string() })) }).safeParse(raw);
    const message = maybeErrors.success ? maybeErrors.data.errors.map((e) => e.message).join("; ") : "";
    throw new ShopifyAdminError("INVALID_RESPONSE", message.slice(0, 500) || "Shopify response did not match the expected catalog schema.");
  }
  if (parsed.data.errors?.length) {
    throw new ShopifyAdminError("UPSTREAM", parsed.data.errors.map((e) => e.message).join("; ").slice(0, 500));
  }

  const products = parsed.data.data.products.edges.map(({ node }) => node);
  return {
    shopDomain: domain,
    products,
    pageInfo: parsed.data.data.products.pageInfo,
    fetchedAt: new Date().toISOString(),
  };
}
