import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readShopifyCatalogPage, ShopifyAdminError } from "../src/lib/shopify-admin";

const originalFetch = globalThis.fetch;
const originalEnv = {
  domain: process.env.SHOPIFY_STORE_DOMAIN,
  token: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
  version: process.env.SHOPIFY_API_VERSION,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnv.domain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
  else process.env.SHOPIFY_STORE_DOMAIN = originalEnv.domain;
  if (originalEnv.token === undefined) delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  else process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalEnv.token;
  if (originalEnv.version === undefined) delete process.env.SHOPIFY_API_VERSION;
  else process.env.SHOPIFY_API_VERSION = originalEnv.version;
});

function configure() {
  process.env.SHOPIFY_STORE_DOMAIN = "7cvgka-gi.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-admin-token";
  process.env.SHOPIFY_API_VERSION = "2026-10";
}

function shopifyResponse() {
  return {
    data: {
      products: {
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        edges: [{
          node: {
            id: "gid://shopify/Product/1",
            title: "Test product",
            handle: "test-product",
            descriptionHtml: null,
            vendor: "Test supplier",
            productType: "Accessories",
            status: "ACTIVE",
            tags: [],
            updatedAt: "2026-11-06T12:00:00Z",
            featuredMedia: null,
            variants: {
              pageInfo: { hasNextPage: false },
              edges: [{
                node: {
                  id: "gid://shopify/ProductVariant/2",
                  title: "Default",
                  sku: "TEST-1",
                  price: "29.99",
                  inventoryQuantity: 0,
                  inventoryItem: {
                    unitCost: { amount: "12.50", currencyCode: "USD" },
                  },
                },
              }],
            },
          },
        }],
      },
    },
  };
}

test("Shopify catalog read validates and returns source observations without changing commerce state", async () => {
  configure();
  let requestBody: unknown;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(shopifyResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await readShopifyCatalogPage(null, 50);
  assert.equal(result.shopDomain, "7cvgka-gi.myshopify.com");
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].variants.edges[0].node.inventoryQuantity, 0);
  assert.equal(result.products[0].variants.edges[0].node.inventoryItem?.unitCost?.amount, "12.50");
  assert.equal(result.pageInfo.hasNextPage, true);
  assert.equal((requestBody as { variables: { first: number; after: string | null } }).variables.first, 50);
});

test("Shopify catalog read fails closed when Admin API credentials are missing", async () => {
  process.env.SHOPIFY_STORE_DOMAIN = "7cvgka-gi.myshopify.com";
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  await assert.rejects(
    readShopifyCatalogPage(null),
    (error: unknown) => error instanceof ShopifyAdminError
      && error.code === "CONFIGURATION"
      && error.status === 503,
  );
});

test("Shopify rate limiting is surfaced as a retryable 429 without parsing an untrusted body", async () => {
  configure();
  globalThis.fetch = (async () => new Response("rate limited", {
    status: 429,
    headers: { "retry-after": "3" },
  })) as typeof fetch;

  await assert.rejects(
    readShopifyCatalogPage(null),
    (error: unknown) => error instanceof ShopifyAdminError
      && error.code === "RATE_LIMITED"
      && error.status === 429,
  );
});

test("malformed Shopify payloads fail closed instead of creating partial catalog data", async () => {
  configure();
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [{ node: { id: "not-a-shopify-id" } }] } },
  }), { status: 200 })) as typeof fetch;

  await assert.rejects(
    readShopifyCatalogPage(null),
    (error: unknown) => error instanceof ShopifyAdminError && error.code === "INVALID_RESPONSE",
  );
});
