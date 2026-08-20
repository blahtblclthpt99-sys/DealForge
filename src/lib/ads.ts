const ADSENSE_CLIENT_RE = /^ca-pub-\d{10,20}$/;
const ADSENSE_SLOT_RE = /^\d{5,20}$/;

export function normalizeAdsenseClient(value = process.env.ADSENSE_CLIENT) {
  const client = value?.trim() ?? "";
  return ADSENSE_CLIENT_RE.test(client) ? client : null;
}

export function normalizeAdsenseSlot(value?: string) {
  const slot = value?.trim() ?? "";
  return ADSENSE_SLOT_RE.test(slot) ? slot : null;
}

export function getAdsenseConfig() {
  return {
    client: normalizeAdsenseClient(),
    homeTop: normalizeAdsenseSlot(process.env.ADSENSE_SLOT_HOME_TOP),
    homeFeed: normalizeAdsenseSlot(process.env.ADSENSE_SLOT_HOME_FEED),
    product: normalizeAdsenseSlot(process.env.ADSENSE_SLOT_PRODUCT),
  };
}

export function adsensePublisherId(client: string) {
  const normalized = normalizeAdsenseClient(client);
  return normalized ? normalized.replace(/^ca-/, "") : null;
}
