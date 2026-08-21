import { AMAZON_ASSOCIATE_TAG } from "@/lib/affiliate/amazon-config";
import { amazonCreatorsConfigured } from "@/lib/affiliate/amazon-creators";
import { isEbayAffiliateConfigured } from "@/lib/affiliate/ebay-config";
import { isAliExpressConfigured } from "@/lib/affiliate/aliexpress-config";

export type AffiliateRuntimeReadiness = {
  id: string;
  trackedLinks: boolean;
  productDataApi: boolean;
  status: "ready" | "partial" | "pending";
  note: string;
};

export function affiliateRuntimeReadiness(id: string): AffiliateRuntimeReadiness {
  switch (id.trim().toLowerCase()) {
    case "amazon": {
      const trackedLinks = Boolean(AMAZON_ASSOCIATE_TAG.trim());
      const productDataApi = amazonCreatorsConfigured();
      return {
        id: "amazon",
        trackedLinks,
        productDataApi,
        status: trackedLinks && productDataApi ? "ready" : trackedLinks ? "partial" : "pending",
        note: productDataApi
          ? "Tracked links and Creators API are configured."
          : "Tracked links are ready; Creators API credentials are still required for current Amazon pricing.",
      };
    }
    case "ebay": {
      const trackedLinks = isEbayAffiliateConfigured();
      return {
        id: "ebay",
        trackedLinks,
        productDataApi: false,
        status: trackedLinks ? "partial" : "pending",
        note: trackedLinks
          ? "EPN tracked links are configured; Browse/API inventory credentials are not connected yet."
          : "EPN runtime tracking credentials are required before importing eBay inventory.",
      };
    }
    case "aliexpress": {
      const trackedLinks = isAliExpressConfigured();
      return {
        id: "aliexpress",
        trackedLinks,
        productDataApi: false,
        status: trackedLinks ? "partial" : "pending",
        note: trackedLinks
          ? "AliExpress Portals tracking is configured; automated inventory retrieval is not enabled."
          : "AliExpress Portals tracking credentials are required before importing inventory.",
      };
    }
    case "walmart":
      return {
        id: "walmart",
        trackedLinks: false,
        productDataApi: false,
        status: "pending",
        note: "Walmart affiliate/Impact tracking is not configured yet.",
      };
    case "etsy":
      return {
        id: "etsy",
        trackedLinks: false,
        productDataApi: false,
        status: "pending",
        note: "Etsy affiliate tracking is not configured yet.",
      };
    case "impact":
    case "cj":
    case "awin":
    case "rakuten":
    case "shareasale":
      return {
        id: id.trim().toLowerCase(),
        trackedLinks: false,
        productDataApi: false,
        status: "pending",
        note: "Network connector exists, but a merchant-specific tracked-link configuration is required.",
      };
    default:
      return {
        id,
        trackedLinks: false,
        productDataApi: false,
        status: "pending",
        note: "Unsupported retailer. No external redirect will be generated.",
      };
  }
}
