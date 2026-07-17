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

export function getConnector(id: AffiliateNetworkId | string): AffiliateConnector {
  const key = id as AffiliateNetworkId;
  return connectors[key] ?? amazonConnector;
}

export function listConnectors(): AffiliateConnector[] {
  return Object.values(connectors);
}

export function generateAffiliateLink(
  retailer: string,
  input: { asin?: string | null; externalId?: string | null; url?: string | null },
) {
  return getConnector(retailer).generateLink(input);
}

export { connectors };
