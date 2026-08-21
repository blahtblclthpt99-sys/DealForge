import { amazonConnector } from "./providers/amazon";
import { ebayConnector } from "./providers/ebay";
import { aliexpressConnector } from "./providers/aliexpress";
import {
  awinConnector,
  cjConnector,
  etsyConnector,
  impactConnector,
  rakutenConnector,
  shareasaleConnector,
  walmartConnector,
} from "./providers/stubs";
import type { AffiliateConnector, AffiliateNetworkId } from "./types";

const connectors: Record<AffiliateNetworkId, AffiliateConnector> = {
  amazon: amazonConnector,
  walmart: walmartConnector,
  ebay: ebayConnector,
  aliexpress: aliexpressConnector,
  cj: cjConnector,
  impact: impactConnector,
  awin: awinConnector,
  rakuten: rakutenConnector,
  shareasale: shareasaleConnector,
  etsy: etsyConnector,
};

function safeStoredHttpsUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.port && url.port !== "443") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function getConnector(id: AffiliateNetworkId | string): AffiliateConnector {
  const connector = connectors[id as AffiliateNetworkId];
  if (!connector) {
    throw new Error(`Unsupported affiliate retailer: ${id}`);
  }
  return connector;
}

export function listConnectors(): AffiliateConnector[] {
  return Object.values(connectors);
}

/**
 * Generate a tracked link only for a registered connector.
 * Unknown retailers must never fall through to Amazon, because doing so can
 * redirect a non-Amazon product to the wrong merchant. For an unsupported
 * retailer we preserve only a syntactically safe stored HTTPS URL; the `/go`
 * route still applies its stricter retailer-host allowlist and will fail closed
 * to the DealForge product page if the retailer itself is unsupported.
 */
export function generateAffiliateLink(
  retailer: string,
  input: { asin?: string | null; externalId?: string | null; url?: string | null },
) {
  const connector = connectors[retailer as AffiliateNetworkId];
  return connector ? connector.generateLink(input) : safeStoredHttpsUrl(input.url);
}

export { connectors };
