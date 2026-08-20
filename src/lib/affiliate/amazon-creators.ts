import { AMAZON_ASSOCIATE_TAG } from "@/lib/affiliate/amazon-config";
import type { AffiliateProductInput } from "@/lib/affiliate/types";

const CREATORS_API_BASE = "https://creatorsapi.amazon/catalog/v1";
const MARKETPLACE = "www.amazon.com";
const REQUEST_TIMEOUT_MS = 12_000;

let tokenCache: { token: string; expiresAt: number } | null = null;

type JsonRecord = Record<string, unknown>;

export type AmazonCreatorItem = AffiliateProductInput & {
  asin: string;
  detailPageUrl: string;
  priceSource: "amazon-creators-api";
  checkedAt: string;
  savingsPercent: number;
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function displayValue(value: unknown) {
  const object = asRecord(value);
  return stringValue(object.displayValue || object.displayValues);
}

function tokenEndpoint(version: string) {
  if (version.startsWith("3.2")) return "https://api.amazon.co.uk/auth/o2/token";
  if (version.startsWith("3.3")) return "https://api.amazon.co.jp/auth/o2/token";
  return "https://api.amazon.com/auth/o2/token";
}

export function amazonCreatorsConfigured() {
  return Boolean(
    process.env.AMAZON_CREATORS_CREDENTIAL_ID?.trim() &&
      process.env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim(),
  );
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const clientId = process.env.AMAZON_CREATORS_CREDENTIAL_ID?.trim();
  const clientSecret = process.env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim();
  const version = process.env.AMAZON_CREATORS_CREDENTIAL_VERSION?.trim() || "3.1";
  if (!clientId || !clientSecret) throw new Error("Amazon Creators API credentials are not configured");

  const response = await fetchWithTimeout(tokenEndpoint(version), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default",
    }),
  });

  if (!response.ok) throw new Error(`Amazon Creators API token request failed (${response.status})`);
  const body = asRecord(await response.json());
  const token = stringValue(body.access_token);
  const expiresIn = Math.max(60, numberValue(body.expires_in) || 3600);
  if (!token) throw new Error("Amazon Creators API token response did not include an access token");

  tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

async function creatorsRequest(path: string, payload: JsonRecord) {
  const token = await getAccessToken();
  const response = await fetchWithTimeout(`${CREATORS_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify({
      ...payload,
      marketplace: MARKETPLACE,
      partnerTag: AMAZON_ASSOCIATE_TAG,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) tokenCache = null;
    throw new Error(`Amazon Creators API ${path} failed (${response.status})`);
  }
  return asRecord(await response.json());
}

function parseCreatorItem(value: unknown): AmazonCreatorItem | null {
  const item = asRecord(value);
  const asin = stringValue(item.asin).trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null;

  const info = asRecord(item.itemInfo);
  const title = displayValue(info.title) || `Amazon product ${asin}`;
  const byLine = asRecord(info.byLineInfo);
  const brand =
    displayValue(byLine.brand) ||
    displayValue(byLine.manufacturer) ||
    displayValue(byLine.contributors) ||
    "Amazon";

  const images = asRecord(item.images);
  const primary = asRecord(images.primary);
  const image =
    stringValue(asRecord(primary.large).url) ||
    stringValue(asRecord(primary.medium).url) ||
    stringValue(asRecord(primary.small).url);

  const offers = asRecord(item.offersV2);
  const listings = asArray(offers.listings).map(asRecord);
  const listing = listings.find((entry) => entry.isBuyBoxWinner === true) || listings[0] || {};
  const offerPrice = asRecord(listing.price);
  const money = asRecord(offerPrice.money);
  const savingBasis = asRecord(offerPrice.savingBasis);
  const savingMoney = asRecord(savingBasis.money);
  const savings = asRecord(offerPrice.savings);
  const price = numberValue(money.amount);
  const originalPrice = numberValue(savingMoney.amount) || price;
  const savingsPercent = numberValue(savings.percentage);
  const availability = stringValue(asRecord(listing.availability).type).toLowerCase() || "unknown";
  const detailPageUrl = stringValue(item.detailPageURL) || `https://www.amazon.com/dp/${asin}?tag=${AMAZON_ASSOCIATE_TAG}`;

  return {
    asin,
    externalId: asin,
    title,
    description: title,
    brand,
    price,
    originalPrice: originalPrice >= price ? originalPrice : price,
    rating: 0,
    reviewCount: 0,
    images: image ? [image] : [],
    availability,
    url: detailPageUrl,
    detailPageUrl,
    priceSource: "amazon-creators-api",
    checkedAt: new Date().toISOString(),
    savingsPercent,
  };
}

export async function getAmazonCreatorItems(asins: string[]) {
  if (!amazonCreatorsConfigured()) return [] as AmazonCreatorItem[];
  const clean = [...new Set(asins.map((asin) => asin.trim().toUpperCase()))]
    .filter((asin) => /^[A-Z0-9]{10}$/.test(asin))
    .slice(0, 10);
  if (!clean.length) return [] as AmazonCreatorItem[];

  const body = await creatorsRequest("getItems", {
    itemIds: clean,
    itemIdType: "ASIN",
    resources: [
      "images.primary.large",
      "itemInfo.title",
      "itemInfo.byLineInfo",
      "offersV2.listings.availability",
      "offersV2.listings.dealDetails",
      "offersV2.listings.isBuyBoxWinner",
      "offersV2.listings.merchantInfo",
      "offersV2.listings.price",
    ],
  });
  const result = asRecord(body.itemsResult);
  return asArray(result.items).map(parseCreatorItem).filter((item): item is AmazonCreatorItem => Boolean(item));
}

export async function searchAmazonCreatorItems(
  query: string,
  options: { page?: number; category?: string } = {},
) {
  if (!amazonCreatorsConfigured()) return [] as AmazonCreatorItem[];
  const keywords = query.trim();
  if (!keywords) return [] as AmazonCreatorItem[];

  const body = await creatorsRequest("searchItems", {
    keywords: keywords.slice(0, 120),
    itemCount: 10,
    itemPage: Math.min(10, Math.max(1, Math.floor(options.page || 1))),
    searchIndex: options.category?.trim() || "All",
    resources: [
      "images.primary.large",
      "itemInfo.title",
      "itemInfo.byLineInfo",
      "offersV2.listings.availability",
      "offersV2.listings.dealDetails",
      "offersV2.listings.isBuyBoxWinner",
      "offersV2.listings.merchantInfo",
      "offersV2.listings.price",
    ],
  });
  const result = asRecord(body.searchResult);
  return asArray(result.items).map(parseCreatorItem).filter((item): item is AmazonCreatorItem => Boolean(item));
}
